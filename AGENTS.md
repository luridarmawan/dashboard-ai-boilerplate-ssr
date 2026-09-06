# AGENTS.md

> Panduan singkat untuk agent AI (termasuk opencode) yang bekerja pada repository ini.

**Sumber kebenaran adalah [`docs/PRD.md`](./docs/PRD.md) (v2.0).** [`BRIEF.md`](./BRIEF.md) adalah ringkasannya — mulai dari sana, tapi kalau keduanya berbeda, **PRD yang menang**.

Wajib dibaca sebelum melakukan perubahan apa pun:

1. [`BRIEF.md`](./BRIEF.md) — seluruhnya. Ringkas, memuat pantangan desain yang tidak boleh dilanggar.
2. [`docs/PRD.md`](./docs/PRD.md) — bagian yang menyentuh pekerjaanmu, plus §1.3 (pantangan), §4.5 (kontrak modul), dan §8 (kriteria terima).
3. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — urutan pengerjaan & gate keluar. Jangan mengerjakan milestone yang gate sebelumnya belum hijau.
4. [`docs/THEMES.md`](./docs/THEMES.md) — bila pekerjaanmu menyentuh tema, ikon, atau layout.

Bila sebuah perubahan mengubah perilaku yang tertulis di PRD, **PRD ikut diperbarui pada commit yang sama** (ROADMAP §7 butir 7).

## Tentang Project

Ini adalah boillerplate untuk membuat app/webapp/dashboard
