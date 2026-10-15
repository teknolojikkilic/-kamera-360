# Kamera 360

İki telefonu ekranları birbirine bakacak (arka kameralar dışa dönük) şekilde bantla, tek tuşla senkron çekim yap, sunucu iki görüntüyü 360° (equirectangular) video ya da fotoğrafa birleştirsin.

## Akış
1. Telefon 1 siteyi açar → **Oda oluştur** → 5 haneli kod.
2. Telefon 2 kodu girer → aynı odaya bağlanır.
3. İki telefonda da kamera seçilir (★ ultra geniş varsa otomatik seçilir, zoom 0.5x destekliyse otomatik en genişe alınır).
4. Telefon 1: Video/Fotoğraf + süre → **Başlat** → 10 sn sesli geri sayım (bu sürede bantla).
5. İki telefon sunucu saatine göre aynı anda kayda başlar, süre bitince otomatik durur ve yükler.
6. Sunucu ffmpeg `v360` ile birleştirir; sonuç sadece odayı kuran telefonun **Galeri**sinde görünür (sürükle/jiroskopla gez, indir, FOV değiştirip yeniden birleştir).

Videolara YouTube/Facebook'un tanıdığı Spherical Video etiketi, fotoğraflara Photo Sphere (GPano) etiketi eklenir.

## Çalıştırma
```bash
npm install
npm start   # http://localhost:3000
```
Kamera erişimi için HTTPS gerekir (Render otomatik verir).

## Ortam değişkenleri
- `PORT` — varsayılan 3000
- `DATA_DIR` — çekimlerin kaydedileceği klasör (varsayılan `./data`)
- `OUT_W_VIDEO` — 360 video genişliği (varsayılan 1920)
- `OUT_W_PHOTO` — 360 fotoğraf genişliği (varsayılan 4096)

## Notlar
- Telefon kameraları ~108–120° görür, 180° değil; iki telefon yanlarda siyah boşluk bırakır. Telefonları **yatay** bantlamak boşluğu azaltır.
- Odalar bellekte, dosyalar diskte tutulur; Render ücretsiz planda sunucu uyuyunca/yeniden başlayınca silinir. Çekimleri indirmeyi unutma.
