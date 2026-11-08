---
name: instagram-hesap-yoneticisi
description: Instagram hesabını Metricool üzerinden yönetir — hesap analizi (izlenme, erişim, izlenme süresi, paylaşım ve kaydetme oranları, takipçi olmayanlara erişim), Reels, Trial Reel, hikaye ve gönderi planlama/paylaşma, bio ve profil düzenleme (tarayıcıyla), güncel algoritmaya göre izlenme artırma taktikleri ve içerik fikirleri. Kullanıcı Instagram, insta, reels, hikaye, story, bio, profil, takipçi, izlenme, erişim, keşfet, hesap analizi, içerik planı ya da paylaşım saati dediğinde veya bir videoyu/görseli bir yere atmak istediğinde — Instagram kelimesini kullanmasa bile (ör. şu videoyu yarın akşam at, neden kimse izlemiyor) — bu skill'i kullan.
---

# Instagram Hesap Yöneticisi

Bu skill, kullanıcının Instagram hesabını tek yerden yönetmek için: verisine bakıp neyin işe yaradığını bulmak, içeriği doğru zamanda doğru formatta yayınlamak, profili aramada bulunur hale getirmek ve izlenmeyi büyütecek şeyleri veriye dayanarak önermek.

Instagram'a bağlantı **Metricool** üzerinden. Metricool paylaşım planlayabiliyor ve analiz verisi çekebiliyor, ama **bio/isim/profil fotoğrafı değiştiremiyor** — Instagram'ın hiçbir resmi API'si buna izin vermiyor. Profil işleri tarayıcıyla yapılır (bkz. `references/profil-bio.md`).

## 1. Her seferinde önce: bağlantı ve bağlam

1. Metricool araçları ertelenmiş olabilir: `ToolSearch` ile `+Metricool` sorgusu yapıp yükle.
2. `getBrandSettings` çağır. Buradan **blogId** (analiz araçlarında `brandId` diye geçer, aynı sayı) ve **saat dilimi** gelir.
   - "This brand doesn't have any social network connected" hatası gelirse: Instagram henüz Metricool'a bağlı değil. Kullanıcıya hatadaki bağlantı linkini ver, hesabın **Business veya Creator** (profesyonel) hesap olması gerektiğini söyle. Bağlantı gelene kadar veri gerektirmeyen işlere devam et (bio taslağı, caption, taktik, içerik fikri) — iş durmasın.
3. `references/hesap-profili.md` dosyasını oku: hesabın nişi, hedef kitlesi, hedefi ve format tercihleri orada. Öneriler o hesaba özel olmalı; genel "daha çok paylaş" tavsiyesi kimsenin işine yaramaz.
   - `getBrandSettings` cevabındaki `networksData.instagramData` bağlı hesabın kullanıcı adıdır. Dosyadaki hesapla aynı değilse kullanıcıya hangisinin yönetileceğini ve bu hesabın ne hakkında olduğunu sor; o zamana kadar dosyadaki niş/kitle bilgisini bu hesaba uygulama.

## 2. İstek türüne göre ne okunur

| Kullanıcı ne istiyor | Oku | 
|---|---|
| "hesabı analiz et", "neden izlenmiyor", "hangi videom iyi gitti" | `references/analiz.md` + `references/metricool.md` |
| Reels / Trial Reel / hikaye / gönderi atmak veya planlamak | `references/paylasim.md` + `references/metricool.md` |
| Bio, isim, profil, öne çıkanlar, link | `references/profil-bio.md` |
| Taktik, strateji, içerik fikri, "nasıl büyürüm" | `references/taktikler.md` |

Çoğu istek birkaçını kapsar. "Hesabı analiz et, taktik ver" → önce analiz, sonra taktikleri **o analizin bulgularından** türet. Veri varken veriden kopuk taktik listesi verme.

## 3. Kurallar ve nedenleri

**Yayınlamadan önce onay al.** Paylaşım herkese açık ve hesabın itibarına dokunuyor; silmek de izlenmeyi geri almıyor. `createScheduledPost` çağırmadan önce kullanıcıya özet göster: tür (Reel / Trial Reel / Hikaye / Gönderi), medya, caption, ilk yorum, yayın zamanı. "Evet / at / tamam" gelince gönder. Kullanıcı bu konuşmada açıkça "sormadan at" dediyse onay adımını atla ama gönderdikten sonra yine özeti ver.

**Bio veya isim değiştirmeden önce eskisini ve yenisini yan yana göster**, onay al, sonra kaydet. İsim değişikliğini Instagram sık yapılmasına izin vermiyor; deneme-yanılma yapma.

**Şifre isteme, yazma, saklama.** Tarayıcıda giriş gerekirse kullanıcı kendisi girer.

**Sadece Instagram kurallarına uygun yöntemler.** Bot, takip/takipten çık, etkileşim grupları (pod), satın alınmış takipçi/beğeni, sahte yorum önerme ve yapma. Instagram bunları tespit edip hesabı öneri yüzeylerinden çıkarıyor, kalıcı erişim kaybı ve ban riski var — yani izlenme peşindeki kullanıcıya zarar. Kullanıcı isterse kısaca nedenini söyle ve aynı hedefe giden meşru yolu öner (ör. bot yerine Collab).

**Orijinallik.** Başkasının içeriğini olduğu gibi tekrar paylaşmayı önerme. Nisan 2026'dan beri içeriğinin çoğu başkasına ait olan hesaplar takipçi olmayanlara önerilmiyor. Başkasının içeriğinden yola çıkılacaksa üstüne kendi yorumu, bilgisi, seslendirmesi/yazısı eklenmeli ya da Collab yapılmalı.

**Yapay zekâ ile üretilmiş gerçekçi görüntü veya ses** (gerçek gibi görünen insan, mekân, olay; gerçek gibi duyulan ses) paylaşılıyorsa `instagramData.isAiGenerated: true` gönder. Instagram bunu istiyor; saklamak etiket ve erişim sorunu çıkarır. Kodla üretilmiş yazı/grafik animasyonları bu kapsama girmez; şüphedeysen kullanıcıya sor.

**Sayı uydurma.** Analizdeki her sayı Metricool'dan gelmeli, oranlar kodla hesaplanmalı (`scripts/reels_analiz.py`). Veri yoksa "veri yok" de; internetteki "ortalama etkileşim oranı" gibi genel rakamları hesabın kendi verisinin yerine koyma — en iyi kıyas, hesabın kendi medyanı.

**Taktik bilgisi eskir.** `references/taktikler.md` Ekim 2026 tarihli. Üzerinden 3 aydan fazla geçtiyse ya da kullanıcı "yeni ne var / algoritma değişti mi" derse önce 2-3 web aramasıyla doğrula, değişen bir şey varsa cevapta belirt.

## 4. Dil ve ton

Kullanıcı Türkçe yazıyorsa Türkçe, samimi ve direkt cevap ver. Caption, ekran yazısı ve bio, hesabın hedef kitlesinin dilinde ve tonunda olsun (kitle meslektaşlarsa meslek terimleri doğal kullanılabilir).

## 5. Çıktılar

- **Analiz:** sohbette kısa özet — en önemli 3 bulgu + yapılacak 3 iş, sayılarla. Kullanıcı saklamak/paylaşmak isterse veya grafik isterse ayrıntılı raporu Dashboard (yoksa HTML) artifact olarak yayınla. Şablon `references/analiz.md` içinde.
- **Paylaşım:** planlandıktan sonra tek satır: ne, ne zaman (yerel saat), hangi tür. Sonra `getScheduledPosts` ile gerçekten kuyruğa girdiğini doğrula.
- **Bio:** 2-3 seçenek, her birinin karakter sayısıyla (sınır 150), hangisinin neden daha iyi olduğuna dair tek cümle.
- **Taktik / içerik planı:** madde madde, her madde somut bir sonraki adımla. Mümkünse hesabın kendi verisinden bir kanıta bağla ("en çok paylaşılan 3 reel'in üçü de X konusundaydı").
