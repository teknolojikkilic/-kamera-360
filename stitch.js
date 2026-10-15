// İki geniş açı görüntüyü (ön + arka) tek bir equirectangular 360 görüntüye birleştirir
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const OUT_W_VIDEO = Number(process.env.OUT_W_VIDEO) || 1920; // Render free CPU zayıf, varsayılan makul
const OUT_W_PHOTO = Number(process.env.OUT_W_PHOTO) || 4096;

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); });
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.slice(-800)))));
  });
}

// ffmpeg -i çıktısından (döndürme uygulanmış) boyutları oku
async function probe(file) {
  const out = await new Promise((resolve) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let s = ''; p.stderr.on('data', (d) => (s += d)); p.on('close', () => resolve(s));
  });
  const m = out.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  let w = m ? Number(m[1]) : 0, h = m ? Number(m[2]) : 0;
  const rot = out.match(/rotate\s*:\s*(-?\d+)/) || out.match(/rotation of (-?\d+)/);
  if (rot && Math.abs(Number(rot[1])) % 180 === 90) [w, h] = [h, w];
  return { w, h, hasAudio: /Audio:/.test(out) };
}

// Uzun kenarın FOV'undan yatay/dikey FOV hesapla
function fovs(w, h, longFov) {
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const longSide = Math.max(w, h), shortSide = Math.min(w, h);
  const half = Math.min(rad(longFov) / 2, rad(89));
  const shortFov = deg(2 * Math.atan(Math.tan(half) * (shortSide / longSide)));
  return w >= h ? { h: longFov, v: shortFov } : { h: shortFov, v: longFov };
}

async function stitch({ dir, shot }) {
  let front = shot.uploads.front, back = shot.uploads.back;
  if (shot.swap) [front, back] = [back, front];
  const fFile = path.join(dir, front.file), bFile = path.join(dir, back.file);
  const [fi, bi] = await Promise.all([probe(fFile), probe(bFile)]);
  const fw = fi.w || front.width, fh = fi.h || front.height;
  const bw = bi.w || back.width, bh = bi.h || back.height;
  if (!fw || !bw) throw new Error('Görüntü boyutu okunamadı');
  const ff = fovs(fw, fh, shot.fov), bf = fovs(bw, bh, shot.fov);

  const isVideo = shot.type === 'video';
  const W = isVideo ? OUT_W_VIDEO : OUT_W_PHOTO, H = W / 2;

  // İki görüntüyü aynı yüksekliğe getirip yan yana koyuyoruz; sonra tek bir remap ile küreye yansıtıyoruz.
  // (v360 filtresi 512 MB'lık Render ücretsiz planına sığmıyor, remap çok daha az bellek kullanıyor.)
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const Hc = isVideo
    ? even(fw >= fh ? Math.min(fh, 1280 * fh / fw) : Math.min(fh, 1280))
    : even(Math.min(fh, bh));
  const fW = even(fw * Hc / fh), bW = even(bw * Hc / bh);
  const xmapFile = path.join(dir, 'xmap.pgm'), ymapFile = path.join(dir, 'ymap.pgm');
  buildMaps({ W, H, fW, bW, Hc, ff, bf, xmapFile, ymapFile });

  const pre = (i, w) => `[${i}:v]${isVideo ? 'fps=30,' : ''}scale=${w}:${Hc},setsar=1[s${i}]`;
  const graph = [
    pre(0, fW), pre(1, bW),
    `[s0][s1]hstack=inputs=2:shortest=1,format=yuv444p[st]`,
    `[st][2:v][3:v]remap=fill=black,format=${isVideo ? 'yuv420p' : 'yuvj420p'}[v]`,
  ].join(';');
  const mapInputs = ['-i', xmapFile, '-i', ymapFile]; // tek kare; remap son kareyi tekrar kullanır

  try {
    if (!isVideo) {
      const out = path.join(dir, '360.jpg');
      await run(['-y', '-hide_banner', '-filter_threads', '1', '-i', fFile, '-i', bFile, ...mapInputs,
        '-filter_complex', graph, '-map', '[v]', '-frames:v', '1', '-q:v', '2', out]);
      addPhotoSphereXmp(out, W, H);
      return '360.jpg';
    }

    // Videoları eşzamanla: geç başlayanın başlangıcına göre erken başlayanı kırp
    const latest = Math.max(front.startedAt, back.startedAt);
    const fOff = Math.max(0, (latest - front.startedAt) / 1000);
    const bOff = Math.max(0, (latest - back.startedAt) / 1000);
    const out = path.join(dir, '360.mp4');
    const args = ['-y', '-hide_banner', '-filter_threads', '1', '-filter_complex_threads', '1',
      '-threads', '1', '-ss', fOff.toFixed(3), '-i', fFile,
      '-threads', '1', '-ss', bOff.toFixed(3), '-i', bFile,
      ...mapInputs,
      '-filter_complex', graph, '-map', '[v]'];
    const audioSrc = fi.hasAudio ? '0:a' : bi.hasAudio ? '1:a' : null;
    if (audioSrc) args.push('-map', audioSrc, '-c:a', 'aac', '-b:a', '128k');
    args.push('-t', String(shot.duration + 1), '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '21',
      '-pix_fmt', 'yuv420p', '-threads', '1', out);
    await run(args);
    try { addSphericalV1(out); } catch (e) { console.warn('360 metadata eklenemedi:', e.message); }
    return '360.mp4';
  } finally {
    fs.rm(xmapFile, () => {}); fs.rm(ymapFile, () => {});
  }
}

// Her çıkış pikseli için (equirect) hangi kameranın hangi pikselinden okunacağını hesapla.
// Ön kamera +z yönüne, arka kamera -z yönüne bakar (180° dönük). Görülmeyen yerler 65535 = siyah.
function buildMaps({ W, H, fW, bW, Hc, ff, bf, xmapFile, ymapFile }) {
  const rad = (d) => (d * Math.PI) / 180;
  const fTx = Math.tan(rad(ff.h) / 2), fTy = Math.tan(rad(ff.v) / 2);
  const bTx = Math.tan(rad(bf.h) / 2), bTy = Math.tan(rad(bf.v) / 2);
  const header = Buffer.from(`P5\n${W} ${H}\n65535\n`, 'latin1');
  const xm = Buffer.alloc(W * H * 2), ym = Buffer.alloc(W * H * 2);
  const sinLon = new Float64Array(W), cosLon = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    const lon = ((x + 0.5) / W) * 2 * Math.PI - Math.PI;
    sinLon[x] = Math.sin(lon); cosLon[x] = Math.cos(lon);
  }
  for (let y = 0; y < H; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
    const cl = Math.cos(lat), dy = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const dx = cl * sinLon[x], dz = cl * cosLon[x];
      let px = 65535, py = 65535;
      if (dz > 1e-6) { // ön kamera
        const u = dx / dz / fTx, v = dy / dz / fTy;
        if (u > -1 && u < 1 && v > -1 && v < 1) {
          px = Math.min(fW - 1, Math.floor(((u + 1) / 2) * fW));
          py = Math.min(Hc - 1, Math.floor(((1 - v) / 2) * Hc));
        }
      } else if (dz < -1e-6) { // arka kamera (yan yana dizide sağda)
        const u = dx / dz / bTx, v = dy / -dz / bTy;
        if (u > -1 && u < 1 && v > -1 && v < 1) {
          px = fW + Math.min(bW - 1, Math.floor(((u + 1) / 2) * bW));
          py = Math.min(Hc - 1, Math.floor(((1 - v) / 2) * Hc));
        }
      }
      const i = (y * W + x) * 2;
      xm.writeUInt16BE(px, i); ym.writeUInt16BE(py, i);
    }
  }
  fs.writeFileSync(xmapFile, Buffer.concat([header, xm]));
  fs.writeFileSync(ymapFile, Buffer.concat([header, ym]));
}

// ---- JPEG'e Photo Sphere (GPano) XMP ekle: Facebook/Google Fotoğraflar 360 olarak tanır ----
function addPhotoSphereXmp(file, w, h) {
  const buf = fs.readFileSync(file);
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return;
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True" GPano:FullPanoWidthPixels="${w}" GPano:FullPanoHeightPixels="${h}" GPano:CroppedAreaImageWidthPixels="${w}" GPano:CroppedAreaImageHeightPixels="${h}" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const payload = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'), Buffer.from(xmp, 'utf8')]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffe1, 0); seg.writeUInt16BE(payload.length + 2, 2);
  fs.writeFileSync(file, Buffer.concat([buf.slice(0, 2), seg, payload, buf.slice(2)]));
}

// ---- MP4'e Spherical Video V1 metadata ekle: YouTube/Facebook 360 olarak tanır ----
// moov dosyanın sonunda olduğu için (faststart yok) chunk offset'leri değişmez.
function addSphericalV1(file) {
  const buf = fs.readFileSync(file);
  const boxes = (start, end) => {
    const list = [];
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      if (size === 1) size = Number(buf.readBigUInt64BE(p + 8));
      if (size === 0) size = end - p;
      if (size < 8) break;
      list.push({ start: p, size, type });
      p += size;
    }
    return list;
  };
  const top = boxes(0, buf.length);
  const moov = top.find((b) => b.type === 'moov');
  const mdat = top.find((b) => b.type === 'mdat');
  if (!moov || !mdat || moov.start < mdat.start) throw new Error('moov sonda değil');
  const traks = boxes(moov.start + 8, moov.start + moov.size).filter((b) => b.type === 'trak');
  const video = traks.find((t) => buf.slice(t.start, t.start + t.size).includes(Buffer.from('vide')));
  if (!video) throw new Error('video trak yok');
  const xml = '<?xml version="1.0"?><rdf:SphericalVideo xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:GSpherical="http://ns.google.com/videos/1.0/spherical/"><GSpherical:Spherical>true</GSpherical:Spherical><GSpherical:Stitched>true</GSpherical:Stitched><GSpherical:StitchingSoftware>Kamera 360</GSpherical:StitchingSoftware><GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType></rdf:SphericalVideo>';
  const uuid = Buffer.from('ffcc8263f8554a938814587a02521fdd', 'hex');
  const body = Buffer.from(xml, 'utf8');
  const box = Buffer.alloc(8 + 16 + body.length);
  box.writeUInt32BE(box.length, 0); box.write('uuid', 4, 'latin1'); uuid.copy(box, 8); body.copy(box, 24);
  const trakEnd = video.start + video.size;
  const out = Buffer.concat([buf.slice(0, trakEnd), box, buf.slice(trakEnd)]);
  out.writeUInt32BE(video.size + box.length, video.start);
  out.writeUInt32BE(moov.size + box.length, moov.start);
  fs.writeFileSync(file, out);
}

module.exports = { stitch, fovs, buildMaps };
