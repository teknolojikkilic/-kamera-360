# Claude çalışma alanından alınan sistem dosyaları

- `proxy-README.md` — Çalışma alanının internete nasıl çıktığını anlatan teknik not (`/root/.ccr/README.md`). Bütün çıkış trafiği izin listeli bir proxy'den geçer.
- `skills/*/SKILL.md` — Claude'un belirli işleri (Word, PowerPoint, Excel, PDF, tarayıcı, bilgisayar kontrolü, araştırma, Instagram hesap yönetimi vb.) yaparken okuduğu talimat dosyaları (`/root/.claude/skills/`). Bir iş geldiğinde ilgili SKILL.md okunur ve ona göre çalışılır.

Not: Modelin kendisi bu dosyalarda yoktur; Anthropic'in sunucularında çalışır. Sertifika dosyaları bilerek eklenmedi.
