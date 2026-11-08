// Sanal ekranı (:99) oda kodlu olarak paylaşır; kontrol ajanıyla aynı anahtarı kullanır.
const { chromium } = require('/opt/npm-tools/node_modules/playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const DIR = __dirname + '/';
const TOKEN = process.argv[2];
const DURATION_MIN = parseInt(process.argv[3] || '60', 10);
const W = 1280, H = 720, FPS = 10;

(async () => {
  let latest = null, buf = Buffer.alloc(0);
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '1', '-framerate', String(FPS),
    '-video_size', `${W}x${H}`, '-i', ':99', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '6', '-'],
    { env: { ...process.env, DISPLAY: ':99' } });
  ff.stderr.on('data', d => console.log('[ffmpeg]', d.toString().trim()));
  ff.stdout.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    let end;
    while ((end = buf.indexOf(Buffer.from([0xff, 0xd9]))) !== -1) {
      const start = buf.indexOf(Buffer.from([0xff, 0xd8]));
      if (start !== -1 && start < end) latest = buf.subarray(start, end + 2).toString('base64');
      buf = buf.subarray(end + 2);
    }
  });

  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--proxy-server=' + process.env.HTTPS_PROXY, '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeFunction('__frame', () => latest);
  await ctx.addInitScript(({ W, H, FPS, TOKEN }) => {
    try { localStorage.setItem('ekran-token', TOKEN); localStorage.setItem('ekran-ad', 'Claude'); } catch {}
    navigator.mediaDevices.getDisplayMedia = async () => {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const img = new Image();
      let busy = false;
      setInterval(async () => {
        if (busy) return; busy = true;
        try {
          const f = await window.__frame();
          if (f) { img.src = 'data:image/jpeg;base64,' + f; await img.decode(); g.drawImage(img, 0, 0, W, H); }
        } catch {} finally { busy = false; }
      }, 1000 / FPS);
      return cv.captureStream(FPS);
    };
  }, { W, H, FPS, TOKEN });

  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('https://kilic-ekran.onrender.com', { waitUntil: 'networkidle', timeout: 90000 });
  await page.locator('#name').fill('Claude');
  await page.locator('#name').dispatchEvent('change');
  await page.locator('#shareBtn').click();
  await page.waitForFunction(() => /\d/.test(document.getElementById('myCode')?.textContent || ''), null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  const code = (await page.locator('#myCode').innerText()).replace(/\D/g, '');
  fs.writeFileSync(DIR + 'oda-kodu.txt', code + '\n');
  console.log('KOD:', code);
  console.log('AJAN:', (await page.locator('#agentText').innerText().catch(() => '?')).trim());
  await page.screenshot({ path: DIR + 'yayin3.png', fullPage: true });

  const end = Date.now() + DURATION_MIN * 60000;
  while (Date.now() < end) {
    await page.waitForTimeout(60000);
    const t = (await page.locator('#viewerCount').innerText().catch(() => '?')).trim();
    const a = (await page.locator('#agentText').innerText().catch(() => '?')).trim();
    console.log('Yayında:', t, '|', a);
  }
  ff.kill(); await browser.close();
})().catch(e => { console.error('HATA', e); process.exit(1); });
