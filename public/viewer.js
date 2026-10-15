/* Basit 360 görüntüleyici: parmakla sürükle, iki parmakla yakınlaştır, istersen telefonu çevirerek bak */
window.Viewer360 = function (container, src, isVideo) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
  const geo = new THREE.SphereGeometry(500, 64, 32);
  geo.scale(-1, 1, 1);

  let video = null, texture;
  if (isVideo) {
    video = document.createElement('video');
    video.src = src; video.crossOrigin = 'anonymous'; video.loop = true; video.muted = true; video.playsInline = true;
    video.setAttribute('playsinline', ''); video.preload = 'auto';
    texture = new THREE.VideoTexture(video);
  } else {
    texture = new THREE.TextureLoader().load(src);
  }
  if ('encoding' in texture) texture.encoding = THREE.sRGBEncoding;
  renderer.outputEncoding = THREE.sRGBEncoding;
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture })));

  let lon = 0, lat = 0, fov = 75, gyro = false, alive = true;
  let gAlpha0 = null, gLon0 = 0;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // Sürükleme ve pinch
  const pts = new Map();
  let lastDist = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId);
    if (pts.size === 1 && !gyro) {
      const k = fov / container.clientHeight;
      lon -= (e.clientX - p.x) * k;
      lat += (e.clientY - p.y) * k;
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDist) fov = Math.max(30, Math.min(110, fov - (d - lastDist) * 0.15));
      lastDist = d;
    }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) lastDist = 0; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); fov = Math.max(30, Math.min(110, fov + e.deltaY * 0.05)); }, { passive: false });

  function onOrient(e) {
    if (!gyro || e.alpha == null) return;
    if (gAlpha0 == null) { gAlpha0 = e.alpha; gLon0 = lon; }
    lon = gLon0 - (e.alpha - gAlpha0);
    lat = Math.max(-85, Math.min(85, e.beta - 90));
  }
  window.addEventListener('deviceorientation', onOrient);

  (function loop() {
    if (!alive) return;
    requestAnimationFrame(loop);
    lat = Math.max(-85, Math.min(85, lat));
    const phi = THREE.MathUtils.degToRad(90 - lat), theta = THREE.MathUtils.degToRad(lon);
    camera.fov = fov; camera.updateProjectionMatrix();
    camera.lookAt(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
    renderer.render(scene, camera);
  })();
  // Başlangıçta görüntünün ortasına (ön kamera) bak
  lon = 180;

  return {
    video,
    async toggleGyro() {
      if (!gyro && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        try { if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false; } catch (_) { return false; }
      }
      gyro = !gyro; gAlpha0 = null;
      return gyro;
    },
    destroy() {
      alive = false; window.removeEventListener('deviceorientation', onOrient);
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
      renderer.dispose(); texture.dispose();
    },
  };
};
