/* Kamera 360 — telefon tarafı */
(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io({ transports: ['websocket', 'polling'] });

  const S = {
    code: null, role: null, ownerToken: null,
    offset: 0, // sunucuSaati ≈ Date.now() + offset
    stream: null, track: null, deviceId: null,
    mode: 'video', room: null, shot: null,
    recorder: null, chunks: [], timers: [],
    wakeLock: null, audioCtx: null,
  };
  const serverNow = () => Date.now() + S.offset;

  // ---------- Ekranlar ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }
  function err(el, msg) { $(el).textContent = msg || ''; }

  // ---------- Saat senkronu ----------
  async function syncClock() {
    const samples = [];
    for (let i = 0; i < 8; i++) {
      const s = await new Promise((resolve) => {
        const t0 = Date.now();
        socket.timeout(3000).emit('sync', t0, (e, r) => {
          if (e || !r) return resolve(null);
          const t1 = Date.now();
          resolve({ rtt: t1 - t0, offset: r.server - (t0 + (t1 - t0) / 2) });
        });
      });
      if (s) samples.push(s);
      await new Promise((r) => setTimeout(r, 80));
    }
    if (!samples.length) return;
    samples.sort((a, b) => a.rtt - b.rtt);
    const best = samples.slice(0, 3);
    S.offset = best.reduce((a, b) => a + b.offset, 0) / best.length;
  }

  // ---------- Ses / titreşim (telefonlar bantlıyken ekran görünmez) ----------
  function beep(freq = 880, ms = 120, vol = 0.4) {
    try {
      S.audioCtx = S.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = S.audioCtx, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; g.gain.value = vol;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + ms / 1000);
    } catch (_) {}
  }
  function unlockAudio() {
    try { S.audioCtx = S.audioCtx || new (window.AudioContext || window.webkitAudioContext)(); S.audioCtx.resume(); } catch (_) {}
  }
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !S.wakeLock) {
        S.wakeLock = await navigator.wakeLock.request('screen');
        S.wakeLock.addEventListener('release', () => (S.wakeLock = null));
      }
    } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.code) keepAwake(); });

  // ---------- Kamera ----------
  const WIDE_RE = /ultra|geniş|genis|0[.,]5|wide angle/i;

  async function listBackCameras() {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const back = devs.filter((d) => !/front|ön|user|selfie|facetime/i.test(d.label));
    return back.length ? back : devs;
  }

  async function openCamera(deviceId) {
    stopCamera();
    $('previewMsg').textContent = 'Kamera açılıyor…';
    $('previewMsg').classList.remove('hidden');
    const video = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: 'environment' } };
    Object.assign(video, { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ video, audio: S.role === 'front' });
    } catch (e) {
      try { S.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
      catch (e2) {
        $('previewMsg').textContent = 'Kameraya erişilemedi: ' + (e2.message || e2.name) + '. Tarayıcı ayarlarından kamera izni ver.';
        socket.emit('ready', false);
        return;
      }
    }
    S.track = S.stream.getVideoTracks()[0];
    S.deviceId = S.track.getSettings().deviceId || deviceId;
    $('preview').srcObject = S.stream;
    await $('preview').play().catch(() => {});
    $('previewMsg').classList.add('hidden');
    setupZoom();
    await fillCameraList();
    socket.emit('ready', true);
  }

  function stopCamera() {
    if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
    S.stream = null; S.track = null;
  }

  async function fillCameraList() {
    const cams = await listBackCameras();
    const sel = $('camSelect');
    sel.innerHTML = '';
    cams.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = c.deviceId;
      o.textContent = (c.label || `Kamera ${i + 1}`) + (WIDE_RE.test(c.label) ? '  ★ geniş' : '');
      if (c.deviceId === S.deviceId) o.selected = true;
      sel.appendChild(o);
    });
    $('camHint').textContent = cams.some((c) => WIDE_RE.test(c.label))
      ? '★ işaretli kamera ultra geniş açı. En iyi 360 için onu seç.'
      : 'Telefonun ultra geniş kamerayı ismiyle göstermiyor olabilir. Listeden tek tek dene, en geniş görüntüyü vereni seç.';
  }

  function setupZoom() {
    const caps = S.track.getCapabilities ? S.track.getCapabilities() : {};
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const z = $('zoom');
      z.min = caps.zoom.min; z.max = Math.min(caps.zoom.max, 5); z.step = caps.zoom.step || 0.1;
      const cur = S.track.getSettings().zoom || 1;
      // 1'in altına inebiliyorsa (0.5x gibi) otomatik en geniş açıya al
      const target = caps.zoom.min < 1 ? caps.zoom.min : cur;
      z.value = target;
      applyZoom(target);
      $('zoomWrap').classList.remove('hidden');
    } else {
      $('zoomWrap').classList.add('hidden');
    }
  }
  async function applyZoom(v) {
    $('zoomVal').textContent = Number(v).toFixed(1) + 'x';
    try { await S.track.applyConstraints({ advanced: [{ zoom: Number(v) }] }); } catch (_) {}
  }
  $('zoom').addEventListener('input', (e) => applyZoom(e.target.value));
  $('camSelect').addEventListener('change', (e) => { localStorage.setItem('k360_cam', e.target.value); openCamera(e.target.value); });

  async function startCameraFlow() {
    // İlk izinden sonra etiketler görünür; kayıtlı ya da "ultra geniş" kamerayı seç
    await openCamera(null);
    if (!S.stream) return;
    const cams = await listBackCameras();
    const saved = localStorage.getItem('k360_cam');
    const pick = cams.find((c) => c.deviceId === saved) || cams.find((c) => WIDE_RE.test(c.label));
    if (pick && pick.deviceId !== S.deviceId) await openCamera(pick.deviceId);
  }

  // ---------- Oda ----------
  function enterRoom({ code, role, ownerToken }) {
    S.code = code; S.role = role;
    if (ownerToken) {
      S.ownerToken = ownerToken;
      localStorage.setItem('k360_owner_' + code, ownerToken);
      localStorage.setItem('k360_last', code);
    }
    sessionStorage.setItem('k360_session', JSON.stringify({ code, role }));
    $('roomCode').textContent = code;
    $('roleTag').textContent = role === 'front' ? 'Telefon 1 · Ön' : 'Telefon 2 · Arka';
    $('ownerPanel').classList.toggle('hidden', role !== 'front');
    $('guestPanel').classList.toggle('hidden', role === 'front');
    $('galleryLink').href = `/gallery.html?code=${code}`;
    show('room');
    keepAwake();
    syncClock();
    startCameraFlow();
  }

  $('btnCreate').addEventListener('click', () => {
    unlockAudio();
    err('homeErr');
    socket.timeout(5000).emit('create', {}, (e, r) => {
      if (e || !r || !r.ok) return err('homeErr', 'Sunucuya ulaşılamadı, tekrar dene.');
      enterRoom(r);
    });
  });

  $('joinForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    unlockAudio();
    const code = $('joinCode').value.trim();
    if (!/^\d{4,5}$/.test(code)) return err('homeErr', 'Kodu doğru gir (5 haneli).');
    const ownerToken = localStorage.getItem('k360_owner_' + code) || undefined;
    socket.timeout(5000).emit('join', { code, ownerToken }, (e, r) => {
      if (e || !r) return err('homeErr', 'Sunucuya ulaşılamadı.');
      if (!r.ok) return err('homeErr', r.error);
      enterRoom({ ...r, ownerToken });
    });
  });

  $('btnLeave').addEventListener('click', () => {
    sessionStorage.removeItem('k360_session');
    stopCamera();
    location.href = '/';
  });

  // Bağlantı koparsa aynı odaya aynı rolle geri dön
  socket.on('connect', () => {
    const sess = JSON.parse(sessionStorage.getItem('k360_session') || 'null');
    if (!sess || !sess.code) return;
    const ownerToken = localStorage.getItem('k360_owner_' + sess.code) || undefined;
    socket.emit('join', { code: sess.code, ownerToken, role: sess.role }, (r) => {
      if (r && r.ok) {
        if (!S.code) enterRoom({ ...r, ownerToken });
        else { syncClock(); if (S.stream) socket.emit('ready', true); }
      } else if (!S.code) sessionStorage.removeItem('k360_session');
    });
  });

  socket.on('room', (room) => {
    S.room = room;
    const mark = (id, on, ready) => {
      $(id).classList.toggle('on', on);
      $(id).classList.toggle('ready', on && ready);
      $(id).querySelector('.dot').title = on ? (ready ? 'Hazır' : 'Kamera bekleniyor') : 'Bağlı değil';
    };
    mark('mFront', room.members.front, room.ready.front);
    mark('mBack', room.members.back, room.ready.back);
    const canStart = room.members.front && room.members.back && room.ready.front && room.ready.back && !room.busy;
    $('btnStart').disabled = !canStart;
    $('startHint').textContent = !room.members.back
      ? `Diğer telefonda siteyi aç ve ${room.code} kodunu gir.`
      : !(room.ready.front && room.ready.back) ? 'Kameralar açılıyor…'
      : room.busy ? 'Çekim sürüyor…' : 'Hazır! Başlat’a bas, 10 saniyede telefonları bantla.';
    if (S.role === 'front' && Number($('fov').value) !== room.fov) { $('fov').value = room.fov; $('fovVal').textContent = room.fov + '°'; }
  });

  // ---------- Ayarlar (sadece oda sahibi) ----------
  $('modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.mode = b.dataset.mode;
    [...$('modeSeg').children].forEach((x) => x.classList.toggle('on', x === b));
    $('durWrap').classList.toggle('hidden', S.mode === 'photo');
  });
  $('fov').addEventListener('input', (e) => { $('fovVal').textContent = e.target.value + '°'; });
  $('fov').addEventListener('change', (e) => socket.emit('setFov', Number(e.target.value)));

  $('btnStart').addEventListener('click', () => {
    unlockAudio();
    err('roomErr');
    socket.emit('start', { type: S.mode, duration: Number($('duration').value) }, (r) => {
      if (!r || !r.ok) err('roomErr', (r && r.error) || 'Başlatılamadı');
    });
  });
  $('btnStop').addEventListener('click', () => socket.emit('stop'));
  $('btnCancel').addEventListener('click', () => socket.emit('cancel'));

  // ---------- Çekim ----------
  function clearTimers() { S.timers.forEach(clearTimeout); S.timers = []; }
  function at(serverTime, fn) {
    const t = setTimeout(fn, Math.max(0, serverTime - serverNow()));
    S.timers.push(t);
  }

  socket.on('go', ({ shotId, type, duration, startAt }) => {
    if (!S.stream) { err('roomErr', 'Kamera açık değil!'); return; }
    keepAwake();
    clearTimers();
    S.shot = { id: shotId, type, duration, startAt };
    $('ownerPanel').classList.add('hidden');
    $('guestPanel').classList.add('hidden');
    $('uploadPanel').classList.add('hidden');
    $('activePanel').classList.remove('hidden');
    $('btnStop').classList.toggle('hidden', type === 'photo');
    $('activeText').textContent = type === 'photo'
      ? 'Fotoğraf için geri sayım. Telefonları şimdi bantla!'
      : `${duration} sn video. Telefonları şimdi bantla!`;

    const cd = $('countdown');
    cd.classList.remove('hidden');
    for (let i = 10; i >= 1; i--) {
      at(startAt - i * 1000, () => {
        cd.textContent = i;
        if (i <= 3) { beep(660, 150); vibrate(80); } else beep(440, 60, 0.2);
      });
    }
    at(startAt - 400, () => { if (type === 'video') prepareRecorder(); });
    at(startAt, () => {
      cd.classList.add('hidden');
      beep(1320, 400); vibrate(300);
      if (type === 'photo') takePhoto(); else startRecording();
    });
    if (type === 'video') at(startAt + duration * 1000, stopRecording);
  });

  socket.on('stopNow', ({ shotId, at: t }) => {
    if (!S.shot || S.shot.id !== shotId) return;
    clearTimers();
    at(t, stopRecording);
  });

  socket.on('cancelled', ({ shotId }) => {
    if (!S.shot || S.shot.id !== shotId) return;
    clearTimers();
    if (S.recorder && S.recorder.state !== 'inactive') { S.recorder.onstop = null; S.recorder.stop(); }
    S.recorder = null; S.shot = null;
    $('countdown').classList.add('hidden');
    $('recBadge').classList.add('hidden');
    resetPanels();
  });

  function resetPanels() {
    $('activePanel').classList.add('hidden');
    $('ownerPanel').classList.toggle('hidden', S.role !== 'front');
    $('guestPanel').classList.toggle('hidden', S.role === 'front');
  }

  function pickMime() {
    const list = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }

  function prepareRecorder() {
    const mimeType = pickMime();
    S.chunks = [];
    S.recorder = new MediaRecorder(S.stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    S.recorder.ondataavailable = (e) => { if (e.data && e.data.size) S.chunks.push(e.data); };
  }

  let recTick = null;
  function startRecording() {
    if (!S.recorder) prepareRecorder();
    const shot = S.shot;
    S.recorder.onstart = () => { shot.startedAt = serverNow(); };
    S.recorder.onstop = () => {
      clearInterval(recTick);
      $('recBadge').classList.add('hidden');
      beep(520, 200); setTimeout(() => beep(520, 200), 280); vibrate([150, 100, 150]);
      const blob = new Blob(S.chunks, { type: S.recorder.mimeType || 'video/webm' });
      const s = S.track.getSettings();
      uploadShot(shot, blob, { startedAt: shot.startedAt || shot.startAt, width: s.width, height: s.height });
      S.recorder = null;
    };
    S.recorder.start(1000);
    $('recBadge').classList.remove('hidden');
    const t0 = Date.now();
    recTick = setInterval(() => { $('recTime').textContent = Math.floor((Date.now() - t0) / 1000); }, 250);
  }

  function stopRecording() {
    if (S.recorder && S.recorder.state !== 'inactive') S.recorder.stop();
  }

  async function takePhoto() {
    const shot = S.shot;
    const v = $('preview');
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    beep(520, 200);
    uploadShot(shot, blob, { startedAt: serverNow(), width: c.width, height: c.height });
  }

  function uploadShot(shot, blob, meta, attempt = 1) {
    $('activePanel').classList.add('hidden');
    $('uploadPanel').classList.remove('hidden');
    $('uploadText').textContent = `Yükleniyor… (${(blob.size / 1048576).toFixed(1)} MB)`;
    const fd = new FormData();
    Object.entries(meta).forEach(([k, v]) => fd.append(k, String(v)));
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : 'jpg';
    fd.append('file', blob, `${S.role}.${ext}`);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload/${S.code}/${shot.id}/${S.role}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) $('uploadBar').style.width = (100 * e.loaded / e.total) + '%'; };
    xhr.onload = () => {
      if (xhr.status === 200) {
        $('uploadText').textContent = S.role === 'front'
          ? 'Yüklendi. Diğer telefon bekleniyor, sonra 360 birleştirilecek.'
          : 'Yüklendi! Sonucu odayı kuran telefon galeride görecek.';
        setTimeout(() => { $('uploadPanel').classList.add('hidden'); $('uploadBar').style.width = '0'; resetPanels(); }, 2500);
      } else retry();
    };
    xhr.onerror = retry;
    function retry() {
      if (attempt < 4) {
        $('uploadText').textContent = `Yükleme hatası, tekrar deneniyor (${attempt}/3)…`;
        setTimeout(() => uploadShot(shot, blob, meta, attempt + 1), 2000 * attempt);
      } else {
        $('uploadText').textContent = 'Yüklenemedi. İnternet bağlantını kontrol et.';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `${S.role}.${ext}`; a.textContent = 'Dosyayı telefona indir';
        a.className = 'btn ghost'; $('uploadPanel').appendChild(a);
      }
    }
    xhr.send(fd);
  }

  // Oda sahibine bitince haber ver
  socket.on('shot', (shot) => {
    if (S.role !== 'front') return;
    if (shot.status === 'done') {
      $('roomErr').textContent = '';
      $('galleryLink').textContent = '✓ Yeni 360 hazır — Galeriyi aç';
      $('galleryLink').classList.add('primary');
      beep(990, 120); setTimeout(() => beep(1320, 160), 160);
    } else if (shot.status === 'stitching') {
      $('galleryLink').textContent = '360 birleştiriliyor… (Galeri)';
    } else if (shot.status === 'error') {
      err('roomErr', shot.error);
    }
  });

  // ---------- Başlangıç ----------
  const last = localStorage.getItem('k360_last');
  if (last && localStorage.getItem('k360_owner_' + last)) {
    $('lastGallery').href = `/gallery.html?code=${last}`;
    $('lastGallery').textContent = `Oda ${last} çekimlerim →`;
    $('lastGallery').classList.remove('hidden');
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    err('homeErr', 'Bu tarayıcı kamera kaydını desteklemiyor. Chrome (Android) ya da Safari (iPhone) kullan.');
  }
})();
