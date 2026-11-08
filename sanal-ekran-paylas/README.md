# Sanal Ekran Paylaş

Linux sanal ekranını (Xvfb :99) kilic-ekran.onrender.com üzerinden oda koduyla yayınlayan araçlar.

- `paylas.js` — ffmpeg ile `:99` ekranını yakalar, sitede "Ekranımı Paylaş"a basar ve oda kodunu `oda-kodu.txt`'ye yazar.
  Kullanım: `node paylas.js <32 haneli token> [dakika]`
- `desktop.html` — sanal ekranda gösterilen saatli masaüstü sayfası.
- `kontrol-ajani.js` — sitenin fare/klavye olaylarını xdotool ile uygulayan Linux ajanı.
  Kullanım: `node kontrol-ajani.js <aynı token>`

Gerekenler: Xvfb, ffmpeg, Google Chrome, xdotool, Node 18+ (`npm i ws https-proxy-agent`, playwright-core).

## Sistem nasıl çalışıyor?

Bu araçlar Claude'un (Anthropic'in yapay zeka modeli) bir sohbette kurduğu çalışma alanında yazıldı ve çalıştırıldı.

**Model nerede?** Modelin kendisi (eğitilmiş sinir ağı) Anthropic'in sunucularında çalışır. Bu dosyalar ya da çalışma alanı modeli içermez; modelin ağırlıklarına Claude'un da erişimi yoktur.

**Çalışma alanı ne?** Claude'a verilen geçici bir Linux makinesi. Komutlar, dosyalar, Chrome, Xvfb ve ffmpeg burada çalışır. Model burada yaşamaz, buraya komut gönderir.

**Döngü:**
1. Kullanıcı mesaj yazar.
2. Modele birlikte gider: konuşmanın tamamı, Anthropic'in talimatları ve kullanılabilir araçların listesi.
3. Model ya cevap yazar ya da bir araç çağrısı üretir (ör. "şu komutu çalıştır").
4. Çağrı çalışma alanında çalıştırılır, çıktısı modele geri döner.
5. Model çıktıya bakıp sonraki adıma karar verir; iş bitene kadar tekrar eder.

Araç çağrıları çalışma alanına ulaşmadan önce ayrı bir güvenlik denetiminden geçer. Örneğin bu ortamı dışarıdan fare/klavye kontrolüne açmak (`kontrol-ajani.js`'i çalıştırmak) bu denetim tarafından engellendi; ajan bu yüzden burada çalıştırılmadı.

**Örnek:** "Terminale `echo merhaba` yaz" isteği → model `xdotool type "echo merhaba"` çağrısı üretir → çalışma alanı çalıştırır → model ekran görüntüsü alıp sonucu doğrular.
