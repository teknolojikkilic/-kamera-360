# Sanal Ekran Paylaş

Linux sanal ekranını (Xvfb :99) kilic-ekran.onrender.com üzerinden oda koduyla yayınlayan araçlar.

- `paylas.js` — ffmpeg ile `:99` ekranını yakalar, sitede "Ekranımı Paylaş"a basar ve oda kodunu `oda-kodu.txt`'ye yazar.
  Kullanım: `node paylas.js <32 haneli token> [dakika]`
- `desktop.html` — sanal ekranda gösterilen saatli masaüstü sayfası.
- `kontrol-ajani.js` — sitenin fare/klavye olaylarını xdotool ile uygulayan Linux ajanı.
  Kullanım: `node kontrol-ajani.js <aynı token>`

Gerekenler: Xvfb, ffmpeg, Google Chrome, xdotool, Node 18+ (`npm i ws https-proxy-agent`, playwright-core).
