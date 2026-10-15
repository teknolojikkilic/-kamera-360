// Kamera 360 — iki telefonu senkron çalıştırıp 360 derece video/fotoğraf üreten sunucu
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');
const { stitch } = require('./stitch');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const COUNTDOWN_MS = 10000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Oda durumu (bellekte) ----
// rooms[code] = { code, ownerToken, createdAt, fov, members: {front: socketId|null, back: socketId|null}, ready: {front, back}, shots: [] }
const rooms = {};

function newCode() {
  let code;
  do { code = String(Math.floor(10000 + Math.random() * 90000)); } while (rooms[code]);
  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    fov: room.fov,
    members: { front: !!room.members.front, back: !!room.members.back },
    ready: room.ready,
    busy: !!room.activeShot,
  };
}

function publicShot(s) {
  return {
    id: s.id, type: s.type, duration: s.duration, createdAt: s.createdAt,
    status: s.status, error: s.error || null, fov: s.fov, swap: !!s.swap,
    uploads: { front: !!s.uploads.front, back: !!s.uploads.back },
    result: s.result ? `/files/${s.roomCode}/${s.id}/${s.result}` : null,
    raw: {
      front: s.uploads.front ? `/files/${s.roomCode}/${s.id}/${s.uploads.front.file}` : null,
      back: s.uploads.back ? `/files/${s.roomCode}/${s.id}/${s.uploads.back.file}` : null,
    },
  };
}

function emitRoom(room) { io.to(room.code).emit('room', publicRoom(room)); }
function emitShot(room, shot) { io.to(room.code).emit('shot', publicShot(shot)); }

// ---- Socket ----
io.on('connection', (socket) => {
  // Saat senkronu: istemci kendi saatini yollar, sunucu kendi saatini döner
  socket.on('sync', (t0, cb) => { if (typeof cb === 'function') cb({ t0, server: Date.now() }); });

  socket.on('create', (_, cb) => {
    const code = newCode();
    const ownerToken = crypto.randomBytes(16).toString('hex');
    rooms[code] = {
      code, ownerToken, createdAt: Date.now(), fov: 108,
      members: { front: socket.id, back: null },
      ready: { front: false, back: false },
      shots: [], activeShot: null,
    };
    socket.join(code);
    socket.data = { code, role: 'front' };
    cb && cb({ ok: true, code, role: 'front', ownerToken });
    emitRoom(rooms[code]);
  });

  // Bağlantı koptuktan sonra aynı role geri dönmek için
  socket.on('join', ({ code, ownerToken, role: wanted } = {}, cb) => {
    code = String(code || '').trim();
    const room = rooms[code];
    if (!room) return cb && cb({ ok: false, error: 'Bu kodla oda yok' });
    let role = null;
    if (ownerToken && ownerToken === room.ownerToken) role = 'front';
    else if (wanted === 'back' || !room.members.back || !io.sockets.sockets.get(room.members.back)) role = 'back';
    if (role === 'back' && room.members.back && room.members.back !== socket.id && io.sockets.sockets.get(room.members.back)) {
      return cb && cb({ ok: false, error: 'Oda dolu (2 telefon zaten bağlı)' });
    }
    if (!role) return cb && cb({ ok: false, error: 'Oda dolu' });
    room.members[role] = socket.id;
    room.ready[role] = false;
    socket.join(code);
    socket.data = { code, role };
    cb && cb({ ok: true, code, role });
    emitRoom(room);
  });

  socket.on('ready', (val) => {
    const { code, role } = socket.data || {};
    const room = rooms[code];
    if (!room) return;
    room.ready[role] = !!val;
    emitRoom(room);
  });

  socket.on('setFov', (fov) => {
    const { code } = socket.data || {};
    const room = rooms[code];
    if (!room) return;
    const n = Number(fov);
    if (n >= 40 && n <= 200) { room.fov = n; emitRoom(room); }
  });

  socket.on('start', ({ type, duration } = {}, cb) => {
    const { code } = socket.data || {};
    const room = rooms[code];
    if (!room) return cb && cb({ ok: false, error: 'Oda bulunamadı' });
    if (!room.members.front || !room.members.back) return cb && cb({ ok: false, error: 'İki telefon da odada olmalı' });
    if (!room.ready.front || !room.ready.back) return cb && cb({ ok: false, error: 'İki telefonun kamerası da hazır olmalı' });
    if (room.activeShot) return cb && cb({ ok: false, error: 'Zaten bir çekim sürüyor' });
    type = type === 'photo' ? 'photo' : 'video';
    duration = Math.max(3, Math.min(120, Number(duration) || 15));
    const shot = {
      id: Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
      roomCode: code, type, duration: type === 'video' ? duration : 0,
      createdAt: Date.now(), startAt: Date.now() + COUNTDOWN_MS,
      status: 'countdown', uploads: { front: null, back: null }, fov: room.fov,
    };
    fs.mkdirSync(path.join(DATA_DIR, code, shot.id), { recursive: true });
    room.shots.unshift(shot);
    room.activeShot = shot.id;
    io.to(code).emit('go', { shotId: shot.id, type, duration: shot.duration, startAt: shot.startAt });
    emitRoom(room);
    emitShot(room, shot);
    cb && cb({ ok: true });
  });

  socket.on('stop', () => {
    const { code } = socket.data || {};
    const room = rooms[code];
    if (!room || !room.activeShot) return;
    io.to(code).emit('stopNow', { shotId: room.activeShot, at: Date.now() + 300 });
  });

  socket.on('cancel', () => {
    const { code } = socket.data || {};
    const room = rooms[code];
    if (!room || !room.activeShot) return;
    const shot = room.shots.find((s) => s.id === room.activeShot);
    io.to(code).emit('cancelled', { shotId: room.activeShot });
    if (shot) { shot.status = 'cancelled'; emitShot(room, shot); }
    room.activeShot = null;
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    const { code, role } = socket.data || {};
    const room = rooms[code];
    if (!room) return;
    if (room.members[role] === socket.id) { room.members[role] = null; room.ready[role] = false; }
    emitRoom(room);
  });
});

// ---- Yükleme ----
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(DATA_DIR, req.params.code, req.params.shotId)),
    filename: (req, file, cb) => {
      const ext = (file.mimetype.includes('mp4') ? 'mp4' : file.mimetype.includes('webm') ? 'webm' : file.mimetype.includes('jpeg') ? 'jpg' : 'bin');
      cb(null, `${req.params.role}.${ext}`);
    },
  }),
  limits: { fileSize: 400 * 1024 * 1024 },
});

app.post('/api/upload/:code/:shotId/:role', (req, res, next) => {
  const room = rooms[req.params.code];
  const shot = room && room.shots.find((s) => s.id === req.params.shotId);
  if (!shot || !['front', 'back'].includes(req.params.role)) return res.status(404).json({ error: 'Çekim bulunamadı' });
  req.room = room; req.shot = shot;
  next();
}, upload.single('file'), (req, res) => {
  const { room, shot } = req;
  const role = req.params.role;
  if (!req.file) return res.status(400).json({ error: 'Dosya yok' });
  shot.uploads[role] = {
    file: req.file.filename,
    startedAt: Number(req.body.startedAt) || shot.startAt,
    width: Number(req.body.width) || 0,
    height: Number(req.body.height) || 0,
  };
  shot.status = shot.uploads.front && shot.uploads.back ? 'stitching' : 'uploading';
  if (room.activeShot === shot.id && shot.uploads.front && shot.uploads.back) room.activeShot = null;
  emitShot(room, shot);
  emitRoom(room);
  res.json({ ok: true });
  if (shot.status === 'stitching') runStitch(room, shot);
});

// Bir tarafın yüklemesi hiç gelmezse odayı kilitli bırakma
setInterval(() => {
  const now = Date.now();
  for (const room of Object.values(rooms)) {
    if (room.activeShot) {
      const shot = room.shots.find((s) => s.id === room.activeShot);
      if (shot && now > shot.startAt + shot.duration * 1000 + 5 * 60 * 1000) {
        shot.status = 'error'; shot.error = 'Bir telefondan dosya gelmedi';
        room.activeShot = null; emitShot(room, shot); emitRoom(room);
      }
    }
    if (now - room.createdAt > ROOM_TTL_MS && !room.members.front && !room.members.back) {
      fs.rm(path.join(DATA_DIR, room.code), { recursive: true, force: true }, () => {});
      delete rooms[room.code];
    }
  }
}, 30 * 1000);

// Ücretsiz sunucuda bellek kısıtlı: birleştirmeler sırayla, tek tek yapılır
let stitchChain = Promise.resolve();
function runStitch(room, shot) {
  shot.status = 'stitching'; shot.error = null;
  emitShot(room, shot);
  stitchChain = stitchChain.then(() => doStitch(room, shot));
}

async function doStitch(room, shot) {
  try {
    const dir = path.join(DATA_DIR, room.code, shot.id);
    shot.result = await stitch({ dir, shot });
    shot.status = 'done';
  } catch (e) {
    console.error('stitch error', e);
    shot.status = 'error';
    shot.error = 'Birleştirme başarısız: ' + String(e.message || e).slice(-300);
  }
  emitShot(room, shot);
}

// ---- Galeri (sadece odayı kuran) ----
function requireOwner(req, res, next) {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Oda bulunamadı (sunucu yeniden başlamış olabilir)' });
  const token = req.get('x-owner-token') || req.query.token;
  if (token !== room.ownerToken) return res.status(403).json({ error: 'Galeriyi sadece odayı kuran telefon görebilir' });
  req.room = room; next();
}

app.get('/api/rooms/:code/shots', requireOwner, (req, res) => {
  res.json({ code: req.room.code, fov: req.room.fov, shots: req.room.shots.map(publicShot) });
});

app.post('/api/rooms/:code/shots/:shotId/restitch', requireOwner, (req, res) => {
  const shot = req.room.shots.find((s) => s.id === req.params.shotId);
  if (!shot || !shot.uploads.front || !shot.uploads.back) return res.status(400).json({ error: 'Çekim eksik' });
  if (shot.status === 'stitching') return res.status(409).json({ error: 'Zaten birleştiriliyor' });
  const fov = Number(req.body.fov);
  if (fov >= 40 && fov <= 200) shot.fov = fov;
  if (req.body.swap !== undefined) shot.swap = !!req.body.swap;
  res.json({ ok: true });
  runStitch(req.room, shot);
});

app.delete('/api/rooms/:code/shots/:shotId', requireOwner, (req, res) => {
  const room = req.room;
  const i = room.shots.findIndex((s) => s.id === req.params.shotId);
  if (i < 0) return res.status(404).json({ error: 'Yok' });
  const [shot] = room.shots.splice(i, 1);
  if (room.activeShot === shot.id) room.activeShot = null;
  fs.rm(path.join(DATA_DIR, room.code, shot.id), { recursive: true, force: true }, () => {});
  io.to(room.code).emit('shotDeleted', { id: shot.id });
  res.json({ ok: true });
});

// Dosyalar: sahibi token ile ya da dosya adı tahmin edilemeyecek kadar rastgele kimlikle
app.get('/files/:code/:shotId/:file', (req, res) => {
  const room = rooms[req.params.code];
  const shot = room && room.shots.find((s) => s.id === req.params.shotId);
  if (!shot) return res.status(404).send('Yok');
  const file = path.basename(req.params.file);
  const full = path.join(DATA_DIR, room.code, shot.id, file);
  if (!fs.existsSync(full)) return res.status(404).send('Yok');
  if (req.query.dl) res.attachment(`kamera360-${shot.id}-${file}`);
  res.sendFile(full);
});

app.get('/healthz', (_, res) => res.send('ok'));

server.listen(PORT, () => console.log(`Kamera 360 http://localhost:${PORT}`));
