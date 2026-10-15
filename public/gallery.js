/* Galeri — sadece odayı kuran telefon (token localStorage'da) */
(() => {
  const $ = (id) => document.getElementById(id);
  const code = new URLSearchParams(location.search).get('code') || localStorage.getItem('k360_last');
  const token = code && localStorage.getItem('k360_owner_' + code);
  $('code').textContent = code || '-';
  const viewers = {}; // shotId -> {viewer, key}
  const openSettings = new Set();

  if (!code || !token) {
    $('err').textContent = 'Galeriyi sadece odayı kuran telefon görebilir. Bu cihazda bu odanın anahtarı yok.';
    return;
  }

  const api = (url, opt = {}) => fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', 'x-owner-token': token, ...(opt.headers || {}) } })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });

  const STATUS = {
    countdown: 'Geri sayım…', uploading: 'Telefonlardan yükleniyor…', stitching: '360 birleştiriliyor…',
    error: 'Hata', cancelled: 'İptal edildi', done: '',
  };
  const fmtTime = (t) => new Date(t).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });

  function render(shots) {
    const list = $('shots');
    if (!shots.length) { list.innerHTML = '<p class="empty">Henüz çekim yok. Odadan “Başlat”a bas.</p>'; return; }
    const ids = new Set(shots.map((s) => s.id));
    // Silinenleri temizle
    [...list.children].forEach((c) => { if (!ids.has(c.dataset.id)) { viewers[c.dataset.id]?.viewer.destroy(); delete viewers[c.dataset.id]; c.remove(); } });
    if (list.querySelector('.empty')) list.innerHTML = '';

    shots.forEach((s, i) => {
      let card = list.querySelector(`[data-id="${s.id}"]`);
      const key = `${s.swap}|${s.status}|${s.result}|${s.fov}|${s.error}|${s.uploads.front}|${s.uploads.back}`;
      if (card && card.dataset.key === key) return;
      const old = card;
      card = document.createElement('article'); card.className = 'shot'; card.dataset.id = s.id;
      card.dataset.key = key;
      if (viewers[s.id]) { viewers[s.id].viewer.destroy(); delete viewers[s.id]; }

      const resultUrl = s.result ? `${s.result}?v=${encodeURIComponent(key)}` : null;
      const label = s.type === 'video' ? `🎥 Video · ${s.duration} sn` : '📷 Fotoğraf';
      card.innerHTML = `
        ${s.status === 'done'
          ? `<div class="viewer"><div class="vbtns">
               ${s.type === 'video' ? '<button data-act="play">▶︎ Oynat</button>' : ''}
               <button data-act="gyro">📱 Hareket</button>
               <button data-act="full">⛶</button></div></div>`
          : `<div class="state"><div>${['stitching', 'uploading', 'countdown'].includes(s.status) ? '<div class="spin"></div>' : ''}
               ${STATUS[s.status] || s.status}
               ${s.status === 'uploading' ? `<div class="small">Ön ${s.uploads.front ? '✓' : '…'} · Arka ${s.uploads.back ? '✓' : '…'}</div>` : ''}
               ${s.error ? `<div class="small err">${s.error}</div>` : ''}</div></div>`}
        <div class="meta">
          <div class="title"><span>${label}</span><span class="muted small">${fmtTime(s.createdAt)}</span></div>
          <div class="actions">
            ${s.result ? `<a class="btn primary" href="${s.result}?dl=1">360 indir</a>` : ''}
            <button class="btn ghost" data-act="del">Sil</button>
          </div>
          ${s.uploads.front && s.uploads.back ? `
          <details ${openSettings.has(s.id) ? 'open' : ''}>
            <summary>Birleştirme ayarları</summary>
            <div class="inner">
              <label>Kamera açısı (FOV) <span class="fv">${s.fov}°</span>
                <input type="range" min="60" max="180" step="1" value="${s.fov}" class="fovIn"></label>
              <label class="check"><input type="checkbox" class="swapIn" ${s.swap ? 'checked' : ''}> Önü/arkayı yer değiştir</label>
              <button class="btn" data-act="restitch" ${s.status === 'stitching' ? 'disabled' : ''}>Yeniden birleştir</button>
              <div class="actions">
                ${s.raw.front ? `<a class="btn ghost" href="${s.raw.front}?dl=1">Ham ön</a>` : ''}
                ${s.raw.back ? `<a class="btn ghost" href="${s.raw.back}?dl=1">Ham arka</a>` : ''}
              </div>
              <p class="hint">Görüntü kenarlarda siyah boşluk kalıyorsa ya da kayıyorsa FOV’u değiştirip yeniden birleştir. Siyah alanlar iki kameranın göremediği yanlardır.</p>
            </div>
          </details>` : ''}
        </div>`;
      if (old) old.replaceWith(card);
      else {
        const ref = list.children[i];
        ref ? list.insertBefore(card, ref) : list.appendChild(card);
      }

      card.querySelector('details')?.addEventListener('toggle', (e) => {
        e.target.open ? openSettings.add(s.id) : openSettings.delete(s.id);
      });
      const fovIn = card.querySelector('.fovIn');
      fovIn?.addEventListener('input', () => (card.querySelector('.fv').textContent = fovIn.value + '°'));

      if (s.status === 'done') {
        const v = window.Viewer360(card.querySelector('.viewer'), resultUrl, s.type === 'video');
        viewers[s.id] = { viewer: v };
      }

      card.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act, v = viewers[s.id]?.viewer;
        if (act === 'play' && v?.video) {
          if (v.video.paused) { v.video.muted = false; await v.video.play().catch(() => { v.video.muted = true; v.video.play(); }); b.textContent = '❚❚ Durdur'; }
          else { v.video.pause(); b.textContent = '▶︎ Oynat'; }
        } else if (act === 'gyro' && v) {
          const on = await v.toggleGyro(); b.textContent = on ? '✋ Sürükle' : '📱 Hareket';
        } else if (act === 'full') {
          const el = card.querySelector('.viewer');
          (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
        } else if (act === 'del') {
          if (!confirm('Bu çekim silinsin mi?')) return;
          await api(`/api/rooms/${code}/shots/${s.id}`, { method: 'DELETE' }).catch((x) => alert(x.message));
          load();
        } else if (act === 'restitch') {
          b.disabled = true;
          await api(`/api/rooms/${code}/shots/${s.id}/restitch`, {
            method: 'POST', body: JSON.stringify({ fov: Number(fovIn.value), swap: card.querySelector('.swapIn').checked }),
          }).catch((x) => alert(x.message));
          load();
        }
      });
    });
  }

  let timer = null;
  async function load() {
    clearTimeout(timer);
    try {
      const data = await api(`/api/rooms/${code}/shots`);
      $('err').textContent = '';
      render(data.shots);
      const busy = data.shots.some((s) => ['countdown', 'uploading', 'stitching'].includes(s.status));
      timer = setTimeout(load, busy ? 2500 : 8000);
    } catch (e) {
      $('err').textContent = e.message;
      timer = setTimeout(load, 8000);
    }
  }
  load();
})();
