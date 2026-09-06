# Tema Bawaan

| | |
|---|---|
| **Status** | Spesifikasi + implementasi token; siap dipakai saat `packages/ui-theme` dibangun |
| **Berkas** | `packages/ui-theme/themes/<id>/` · `packages/ui-theme/icons/registry.json` · `packages/ui-theme/layouts/registry.json` |
| **Validator** | `node packages/ui-theme/validate.mjs` — menegakkan L-3, L-5, L-8, L-21 |
| **Kontrak** | [`PRD.md` §4.8](./PRD.md) — anatomi tema; FR-L L-2…L-15 |

Dokumen ini menjelaskan **kenapa** tiap tema seperti itu. Nilai tokennya sendiri ada di berkas CSS — itu sumber kebenarannya, bukan tabel di sini.

---

## 1. Empat tema bawaan

L-3 menuntut tema yang berbeda **karakter**, bukan empat palet dari keluarga warna yang sama. Ukurannya konkret dan divalidasi otomatis: minimal dua layout dashboard berbeda dan minimal dua set ikon berbeda di antara tema bawaan.

| Tema | Karakter | Radius | Set ikon | Layout dashboard | Font |
|---|---|---|---|---|---|
| **`base`** — Netral | Tidak berpendapat. Titik awal untuk tema turunan proyek. | `0.5rem` | `outline-24` | `sidebar-classic` | Inter |
| **`corporate`** — Korporat | Formal, padat, navy. **Navigasi atas, bukan sidebar.** | `0.25rem` | `outline-24` | `topnav-compact` | IBM Plex Sans |
| **`warm`** — Hangat | Netral bersuhu hangat, membulat, terracotta. **Ikon padat.** | `0.75rem` | `solid-24` | `sidebar-classic` | Plus Jakarta Sans |
| **`contrast`** — Kontras Tinggi | Hitam-putih murni, fokus tebal, tanpa bayangan. **Ikon tebal.** | `0.25rem` | `bold-24` | `sidebar-classic` | Atkinson Hyperlegible |

`corporate` adalah tema yang membuktikan klaim "tema mencakup layout": memilihnya mengubah susunan dashboard dari sidebar jadi navigasi atas, tanpa satu halaman pun berubah. `warm` dan `contrast` membuktikan klaim yang sama untuk ikon.

Semua font berlisensi permisif (OFL/Apache) dan **di-host sendiri**, bukan dari CDN — konsisten dengan §7 (tidak ada permintaan pihak ketiga di jalur render) dan dengan target self-hosted.

### Kenapa empat ini

- **`base`** ada karena setiap proyek akan menurunkan temanya sendiri. Ia sengaja netral supaya jadi titik awal yang jelas, bukan pesaing tema lain.
- **`corporate`** mewakili kasus nyata yang paling sering diminta klien: aplikasi internal padat informasi, di mana sidebar memakan lebar yang dibutuhkan tabel.
- **`warm`** ada supaya landing komersil modul `Example` (§4.6) punya tema yang cocok. Ia juga membuktikan bahwa netral tidak harus berarti abu-abu.
- **`contrast`** bukan sekadar "tema keempat". Ia memaksa kita menulis komponen yang tidak bergantung pada bayangan dan gradasi halus untuk menyampaikan batas — dan itu memperbaiki tiga tema lainnya juga.

---

## 2. Kontras: diverifikasi, bukan diklaim

L-21 mewajibkan WCAG AA pada **setiap** tema, bukan hanya tema baku. Ini dijalankan `validate.mjs` di CI. Angka di bawah adalah keluaran nyata dari validator, bukan perkiraan.

| Tema / mode | fg/bg | muted-fg/bg | muted-fg/muted | pri-fg/pri | pri/bg | dest-fg/dest | input/bg | ring/bg |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `base/light` | 17.85 | 7.58 | 6.92 | 5.17 | 5.17 | 4.83 | 3.38 | 5.17 |
| `base/dark` | 15.19 | 7.30 | 5.71 | 5.09 | 5.09 | 4.98 | 4.86 | 7.36 |
| `corporate/light` | 16.69 | 6.59 | 5.86 | 8.65 | 8.65 | 6.54 | 3.18 | 8.65 |
| `corporate/dark` | 14.44 | 7.45 | 6.13 | 6.16 | 6.16 | 4.95 | 4.34 | 8.44 |
| `warm/light` | 15.29 | 6.71 | 5.96 | 5.00 | 4.82 | 6.62 | 3.48 | 4.82 |
| `warm/dark` | 14.91 | 7.64 | 6.68 | 6.15 | 6.15 | 6.28 | 4.11 | 6.15 |
| `contrast/light` | 21.00 | 11.37 | 10.16 | 10.04 | 10.04 | 8.35 | 7.00 | 10.04 |
| `contrast/dark` | 21.00 | 13.62 | 11.28 | 10.13 | 10.13 | 9.20 | 8.63 | 12.80 |

Ambang: **4.5** untuk teks (WCAG 1.4.3), **3.0** untuk komponen UI non-teks (WCAG 1.4.11).

### `--border` dan `--input` bukan hal yang sama

Ini perbedaan yang mudah terlewat dan menyebabkan salah satu dari dua kesalahan: mewajibkan 3:1 pada semua garis (semua tema jadi kasar dan berat), atau tidak mewajibkannya sama sekali (kotak isian jadi tak terlihat).

- **`--border`** dekoratif: pemisah, garis kartu, garis tabel. WCAG **tidak** mewajibkan 3:1 untuk ini, karena ia tidak menyampaikan informasi yang diperlukan untuk mengenali sebuah kontrol. Validator sengaja tidak memeriksanya.
- **`--input`** adalah batas kontrol form. Di sinilah 3:1 **wajib** — batas itulah yang memberi tahu pengguna di mana kotak isian berada. Validator memeriksanya.

Konsekuensinya terlihat di nilai token: `base` punya `--border: #e2e8f0` yang lembut (1.23:1, dan itu benar) berdampingan dengan `--input: #7d8da3` yang tegas (3.38:1). Dua peran berbeda, dua nilai berbeda.

---

## 3. Set ikon

Nama ikon semantik milik core ada di `icons/registry.json` (78 nama). Komponen memakai `<Icon name="save" />`, tidak pernah mengimpor glyph — ditegakkan lint rule (L-5).

| Set | Gaya | Sumber | Lisensi | Dipakai |
|---|---|---|---|---|
| `outline-24` | garis, 1.75px | Lucide | ISC | `base`, `corporate` |
| `solid-24` | padat | Phosphor (fill) | MIT | `warm` |
| `bold-24` | garis, 2.75px | Lucide, stroke dinaikkan | ISC | `contrast` |

Set ikon **wajib menutup seluruh nama terdaftar**. Yang bolong menggagalkan build di CI, bukan diam-diam jatuh ke ikon kosong — karena kekurangan seperti itu biasanya baru ketahuan dari halaman yang jarang dibuka.

Modul mendaftarkan nama ikonnya sendiri di namespace `<modul>.*` (G-9), sehingga dua modul dari penulis berbeda tidak bisa berebut nama `settings`.

---

## 4. Layout & varian

Layout bawaan ada di `layouts/registry.json`. Region per jenis shell:

| Jenis | Region wajib |
|---|---|
| `dashboard` | `brand`, `nav`, `header`, `breadcrumb`, `content`, `aside`, `footer` |
| `public` | `brand`, `nav`, `content`, `footer` |
| `auth` | `brand`, `content`, `footer` |

| Layout | Jenis | Bentuk |
|---|---|---|
| `sidebar-classic` | dashboard | Sidebar kiri yang bisa diciutkan + header |
| `topnav-compact` | dashboard | Navigasi horizontal, tanpa sidebar, konten selebar layar |
| `centered-narrow` | dashboard | Kolom sempit di tengah untuk wizard & form panjang |
| `marketing-wide` | public | Header transparan, bagian selebar layar, footer tebal |
| `centered-card` | auth | Kartu tunggal di tengah |
| `split-hero` | auth | Form di kiri, panel merek di kanan; menumpuk di layar sempit |

**Varian** (Keputusan K): halaman menyebut kebutuhannya (`layoutVariant = 'wide'`), tema yang memetakannya ke layout konkret. Perhatikan bahwa `corporate` menjawab `wide` dengan `topnav-compact` — yang juga layout `default`-nya — sementara `base` memakainya hanya untuk halaman lebar. Halaman yang sama, dua susunan berbeda, nol perubahan kode.

Tema yang tidak memetakan sebuah varian jatuh ke `default` miliknya dengan peringatan di dev, bukan galat. Ini yang membuat tema pihak ketiga tidak wajib mengenal setiap varian yang pernah dibuat orang lain.

---

## 5. Menambah tema baru

```bash
cp -r packages/ui-theme/themes/base packages/ui-theme/themes/<id>
# 1. ubah selektor [data-app-theme='base'] -> [data-app-theme='<id>'] di tokens.css
# 2. ubah "id" dan "name" di theme.json
# 3. pilih set ikon & layout (harus yang terdaftar)
node packages/ui-theme/validate.mjs
```

Validator akan memberi tahu persis apa yang kurang: token yang belum terdefinisi, set ikon atau layout yang tidak terdaftar, atau pasangan warna yang gagal kontras — lengkap dengan rasio yang didapat dan yang dibutuhkan.

Modul menyumbang tema lewat titik perluasan 14 dengan bentuk folder yang sama persis (§4.5). Tidak ada perlakuan istimewa untuk tema core.

**Yang tidak boleh dilakukan tema** (§4.8): mengganti implementasi komponen, menambah atau mengubah route, mengubah data atau perilaku, dan mem-bypass RBAC. Tema boleh menetapkan nilai baku varian komponen; tidak boleh menulis ulang komponennya.

---

## 6. Yang belum dikerjakan

Token, manifest, registry, dan validator sudah lengkap dan terverifikasi. Yang menunggu kerangka aplikasi ada:

- **Aset merek per tema** (`logo.svg`, `favicon.svg`, `preview.png`) — manifest sudah merujuknya; berkasnya dibuat saat identitas visual proyek ditetapkan.
- **Komponen layout** (`.svelte`) untuk enam layout terdaftar — registry sudah mendefinisikan kontrak dan region-nya.
- **Berkas pemetaan ikon** per set — daftar nama semantiknya sudah final, pemetaan ke glyph dibuat saat pustaka ikon dipasang.
- **Berkas font yang di-host sendiri** beserta `@font-face`-nya.

Keempatnya adalah pekerjaan M2 (§9 Rencana Rilis). Kontraknya sudah dikunci lebih dulu, jadi pekerjaan itu tinggal mengisi, bukan memutuskan.
