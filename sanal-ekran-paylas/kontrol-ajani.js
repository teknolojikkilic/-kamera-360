// kontrol.ps1'in Linux karşılığı: sitedeki fare/klavye olaylarını xdotool ile sanal ekrana (:99) uygular.
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { spawn } = require('child_process');

const URL = 'wss://kilic-ekran.onrender.com/agent';
const TOKEN = process.argv[2];
const W = 1280, H = 720;
if (!/^[a-f0-9]{32}$/.test(TOKEN || '')) { console.error('Token gerekli'); process.exit(1); }

const ENV = { ...process.env, DISPLAY: ':99', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- xdotool kuyruğu (sıralı; fare hareketleri birleştirilir) ----
const queue = [];
let running = false, pendingMove = null;
function xdo(args) { queue.push(args); pump(); }
function move(x, y) { pendingMove = [x, y]; pump(); }
function pump() {
  if (running) return;
  let args = queue.shift();
  if (!args && pendingMove) { args = ['mousemove', ...px(...pendingMove)]; pendingMove = null; }
  if (!args) return;
  running = true;
  const p = spawn('xdotool', args, { env: ENV, stdio: 'ignore' });
  p.on('close', () => { running = false; pump(); });
  p.on('error', () => { running = false; pump(); });
}
const clamp = v => Math.max(0, Math.min(1, Number(v) || 0));
const px = (x, y) => [String(Math.round(clamp(x) * (W - 1))), String(Math.round(clamp(y) * (H - 1)))];
const btn = b => (b === 2 ? '3' : b === 1 ? '2' : '1');
function at(m) { pendingMove = null; xdo(['mousemove', ...px(m.x, m.y)]); }

const SPECIAL = {
  Enter: 'Return', Backspace: 'BackSpace', Tab: 'Tab', Escape: 'Escape', Esc: 'Escape', ' ': 'space',
  Spacebar: 'space', PageUp: 'Prior', PageDown: 'Next', End: 'End', Home: 'Home',
  ArrowLeft: 'Left', ArrowUp: 'Up', ArrowRight: 'Right', ArrowDown: 'Down', Left: 'Left', Up: 'Up',
  Right: 'Right', Down: 'Down', Insert: 'Insert', Delete: 'Delete', Del: 'Delete', Meta: 'super',
  OS: 'super', Win: 'super', ContextMenu: 'Menu', CapsLock: 'Caps_Lock', Pause: 'Pause', PrintScreen: 'Print',
};
function key(m) {
  const k = m.k || '', c = m.c || '';
  let ks = SPECIAL[k] || (/^F([1-9]|1\d|2[0-4])$/.test(k) ? k : null);
  if (!ks && /^Key[A-Z]$/.test(c) && (m.ctrl || m.alt || m.meta)) ks = c[3].toLowerCase();
  if (!ks && /^Digit\d$/.test(c) && (m.ctrl || m.alt || m.meta)) ks = c[5];
  if (!ks) {
    if (k.length >= 1 && [...k].length === 1 && !m.ctrl && !m.alt && !m.meta) return xdo(['type', '--delay', '0', '--', k]);
    if (k.length === 1) ks = k.toLowerCase();
    else return;
  }
  const mods = [];
  if (m.ctrl) mods.push('ctrl');
  if (m.alt) mods.push('alt');
  if (m.shift && (SPECIAL[k] || /^F\d/.test(k) || m.ctrl || m.alt)) mods.push('shift');
  if (m.meta && ks !== 'super') mods.push('super');
  xdo(['key', '--clearmodifiers', [...mods, ks].join('+')]);
}
function wheel(dy, dx) {
  const steps = (v) => Math.max(1, Math.min(10, Math.round(Math.abs(v) / 120)));
  if (dy) xdo(['click', '--repeat', String(steps(dy)), dy > 0 ? '4' : '5']);
  if (dx) xdo(['click', '--repeat', String(steps(dx)), dx > 0 ? '7' : '6']);
}

// ---- Bağlantı ----
let ws;
function connect() {
  ws = new WebSocket(URL, { agent: new HttpsProxyAgent(process.env.HTTPS_PROXY) });
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'hello', token: TOKEN, screens: [{ w: W, h: H, primary: true }] }));
    log('Sunucuya bağlandı.');
  });
  ws.on('message', data => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    switch (m.t) {
      case 'move': move(m.x, m.y); break;
      case 'down': at(m); xdo(['mousedown', btn(m.b | 0)]); break;
      case 'up': at(m); xdo(['mouseup', btn(m.b | 0)]); break;
      case 'click': at(m); xdo(['click', '--repeat', String(Math.max(1, Math.min(2, m.n | 0))), btn(m.b | 0)]); break;
      case 'wheel': wheel(m.dy | 0, m.dx | 0); break;
      case 'text': xdo(['type', '--delay', '5', '--', String(m.s || '').slice(0, 500)]); break;
      case 'key': key(m); break;
      case 'ask': // bu odaya sadece kodu bilen girebiliyor
        log('Kontrol isteği:', m.name || '?', '→ izin verildi');
        ws.send(JSON.stringify({ t: 'answer', id: m.id, allow: true }));
        break;
      case 'info': log('Bilgi:', m.s); break;
      case 'meta': log('Paylaşılan görüntü:', m.w + 'x' + m.h); break;
    }
  });
  ws.on('close', code => {
    log('Bağlantı kapandı', code);
    if (code === 4003) process.exit(0);
    setTimeout(connect, 3000);
  });
  ws.on('error', e => log('Hata:', e.message));
}
connect();
