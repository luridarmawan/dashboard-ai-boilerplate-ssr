# Tema Bawaan

| | |
|---|---|
| **Status** | Empat tema bawaan + tema modul (berkas), dan **editor tema dari UI admin** (L-24) yang menyimpan tema kustom ke database tanpa deploy |
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
| `marketing-wide` | public | Header lengket semi-transparan, bagian selebar layar, footer tebal |
| `centered-card` | auth | Kartu tunggal di tengah |
| `split-hero` | auth | Form di kiri, panel merek di kanan; menumpuk di layar sempit |

**Sidebar yang bisa diciutkan (F-8).** Layout yang punya rail melakukan **dua hal**: menggambar `<SidebarToggle />` (`@core/ui`) di kepala rail-nya, dan memanggil region nav dengan `nav({ orientation: 'vertical', rail: true })`. Layout tanpa sidebar tidak melakukan keduanya dan tidak terpengaruh sama sekali. Dua layout bawaan yang punya rail — `sidebar-classic` dan `dummy.two-column` milik modul Dummy (tema `dummy.ocean`) — mengerjakannya dengan cara yang sama persis; tidak ada jalur istimewa untuk core.

Keadaannya diputuskan di server (`apps/web/src/lib/server/sidebar.ts`) dan ditulis sebagai atribut `data-sidebar="expanded|collapsed"` di `<html>` sebelum byte pertama, jadi rail sempit sudah benar pada HTML pertama — tanpa kedipan, tanpa JavaScript. CSS layout-lah yang memutuskan arti "ciut" untuk dirinya (rail 3,5rem; label di-*clip* dengan teknik sr-only supaya nama tautan tetap terbaca pembaca layar). Pilihannya melekat pada **pengguna** (kolom `users.sidebar_collapsed`, disalin ke cookie `dab_sidebar` untuk browser yang belum masuk), jadi browser lain milik orang yang sama membuka dasbor dengan rail yang sama.

`rail: true` itulah yang membuat shell memperlakukan nav sebagai rail dan bukan sekadar menu vertikal: setiap butir membawa **tooltip** berisi namanya (satu-satunya cara membaca label yang sedang di-clip), dan **tidak ada grup yang dirender terbuka** saat ciut. Yang terakhir itu penting: grup terbuka adalah **sinyal** bahwa pembaca minta lebarnya kembali, jadi seluruh aturan ciut mati saat `#sidebar-rail:has(details[open])` — mengetuk ikon grup melebarkan sidebar dan menampilkan anak menunya, tanpa JavaScript. Dengan JavaScript, `use:railExpand` membuat pilihan itu **bertahan** (menekan tombol toggle yang sudah ada, jadi preferensinya tersimpan) dan menutup grup yang terbuka saat pengguna menciutkan lagi.

**Region `aside` bersifat opsional.** Layout **wajib** menggambarnya bila diberi, dan **wajib** menciut jadi satu kolom bila tidak — layout tidak boleh mengarang isi kolom kedua sendiri. Halaman tidak bisa menyerahkan snippet ke shell (shell dirender lebih dulu), jadi halaman **menyebut nama**-nya:

```ts
// +page.server.ts (atau +page.ts)
export const _aside = 'examples.aside';
```

Nama itu dikumpulkan `bun run layout:variants` ke `pageAsides`, diselesaikan di `(app)/+layout.server.ts`, lalu komponennya di-code-split di `(app)/+layout.ts` — persis perlakuan varian layout, jadi kolom sampingnya sudah ada di HTML pertama dan tetap tampil tanpa JavaScript. Komponen aside terdaftar di `apps/web/src/lib/asides/registry.ts`, tidak menerima props, dan membaca data `load` halamannya lewat `page.data`. Contoh hidupnya: **`/examples/aside`**.

**Varian** (Keputusan K): halaman menyebut kebutuhannya (`layoutVariant = 'wide'`), tema yang memetakannya ke layout konkret. Halaman yang sama, dua susunan berbeda, nol perubahan kode: `/users` mendeklarasikan `wide` dan dijawab `sidebar-classic` oleh `base`, `topnav-compact` oleh `corporate`, `dummy.two-column`… oleh tema modul.

Semua tema yang dikapalkan — keempat tema bawaan maupun tema modul `dummy.ocean` — sengaja menjawab `wide` dengan layout `default` mereka sendiri, sehingga **satu tema = satu shell untuk seluruh aplikasi**: berpindah ke halaman lebar tidak pernah menukar sidebar jadi navigasi atas di tengah jalan. Tema turunan bebas memilih sebaliknya — petakan `wide` ke layout lain kalau memang menginginkan shell berbeda untuk halaman padat tabel.

Tema yang tidak memetakan sebuah varian jatuh ke `default` miliknya dengan peringatan di dev, bukan galat. Ini yang membuat tema pihak ketiga tidak wajib mengenal setiap varian yang pernah dibuat orang lain.

---

## 5. Menambah tema baru

```bash
bun themegen senja --from warm --name "Senja" --name-en "Dusk"
```

Generator (P-11) menurunkan tema baru dari tema yang **sudah** lolos kontrak, lalu **mendaftarkannya** — bagian yang tidak bisa dilakukan `cp -r`:

1. `packages/ui-theme/themes/<id>/tokens.css` — salinan palet tema sumber dengan **seluruh** selektornya ditulis ulang ke id baru (blok terang dan gelap), jadi tidak ada sisa yang diam-diam masih menata tema sumber
2. `packages/ui-theme/themes/<id>/theme.json` — id, nama, deskripsi, set ikon, dan peta layout (ikut tema sumber kecuali ditimpa `--icons` / `--layout-dashboard|public|auth`)
3. **`packages/ui-theme/src/registry.ts`** — import manifest, disisipkan urut path supaya `bun run lint` tetap hijau, plus daftar tema bawaan
4. **`apps/web/src/app.css`** — import tokens, sebelum blok tema modul

Tanpa dua yang terakhir tema itu tidak pernah muncul di runtime dan tokennya tidak ikut ter-bundle. Langkah terakhir generator adalah `bun run theme:validate`, jadi yang dihasilkannya sudah lolos gate yang sama dengan tema tulis tangan. Set ikon atau layout yang tidak terdaftar ditolak **sebelum** ada berkas ditulis (L-5, L-8).

Flag lain: `--module <Nama>` menulis tema ke `modules/<Nama>/themes/<id>` sebagai `<ns>.<id>` dan menjalankan `modules:sync` — **tanpa menyentuh satu pun berkas core** (titik perluasan 14); `--dry-run` hanya mencetak rencana; `--force` menimpa folder yang sudah ada; `--no-register` menulis berkas saja.

Yang **masih pekerjaan Anda** sesudahnya: warnanya. Hasil generator adalah palet tema sumber — sunting `tokens.css`, lalu jalankan `bun run theme:validate` lagi. Validator memberi tahu persis apa yang kurang: token yang belum terdefinisi, set ikon atau layout yang tidak terdaftar, atau pasangan warna yang gagal kontras — lengkap dengan rasio yang didapat dan yang dibutuhkan. Ganti `--font-sans`? Tambahkan juga `@import "@fontsource/<font>/…"` di `apps/web/src/app.css` (§7: font di-host sendiri).

Modul menyumbang tema lewat titik perluasan 14 dengan bentuk folder yang sama persis (§4.5). Tidak ada perlakuan istimewa untuk tema core.

### 5a. Tema kustom dari UI admin (L-24)

Admin dengan izin `theme.manage` membuka **Tema kustom** (`/themes`), memilih tema awal (core atau kustom lain), lalu **merakit**: nilai token (terang dan gelap), set ikon dari yang terdaftar, layout per jenis shell dari yang terdaftar, nama dan slug. Simpan → tema `custom.<slug>` hidup **seketika di semua instance** (dibaca lewat cache berversi, seperti konfigurasi), muncul di pemilih tema, di daftar tema profil, dan sebagai opsi tema baku/allowlist di Pengaturan. Superadmin bisa membuat tema **global** (`?scope=global`) yang berlaku di semua tenant; tema tenant dengan slug sama menutupinya. Pengunjung **anonim** hanya melihat scope global (aturan yang sama dengan konfigurasi publik), jadi tema untuk landing page publik harus dibuat global.

Yang tidak berubah: **kontraknya**. Sebelum tersimpan, tema kustom harus lolos pemeriksaan yang sama dengan tema berkas di CI — set ikon terdaftar (L-5), layout terdaftar dan sesuai jenis shell (L-8), seluruh token terisi, dan kontras WCAG AA di kedua mode (L-21, pasangan yang sama dengan `validate.mjs`, di `packages/ui-theme/src/custom.ts`). Pelanggaran dijawab 422 dengan daftar pasangan dan rasionya, dan tidak ada yang disimpan. Editor merakit tema, bukan membuat kode: tidak ada layout baru, komponen, atau CSS bebas — nilai token disanitasi dan hanya bisa berupa warna, ukuran, atau daftar font.

Cara kerjanya: tabel `themes` (`scope`, `code`, `tokens` json, `icons`, `layouts` json); API `GET /v1/themes/custom` (anonim, manifest + CSS untuk tenant aktif) dan `GET/POST/PUT/DELETE /v1/themes/custom[/…]` (`theme.manage`); web memuat daftar itu per request bersama konfigurasi publik, menambahkannya ke rantai resolusi (`resolveTheme({ extra })`), dan menyuntikkan CSS tema kustom yang aktif ke `<head>` lewat placeholder `%theme_css%` — tema berkas tetap dari bundel. Pratinjau di editor dan pemilih dihitung dari token yang tersimpan. Bukti: `apps/api/test/integration/themes-custom.test.ts`, `packages/ui-theme/test/custom.test.ts`.

**Logo tema (Q-16):** editor menerima berkas logo (PNG/JPEG/WebP/SVG/GIF). Berkas itu diunggah lewat `POST /v1/files` sebagai berkas **publik** berjenis `theme-logo`, id-nya disimpan di kolom `themes.assets`, dan manifest tema kustom membawanya sebagai URL (`/v1/files/<id>/content`) yang dirender semua shell di tempat ikon merek (header dasbor, publik, auth). Centang **hapus logo** untuk kembali ke ikon. Favicon **baku** aplikasi adalah `apps/web/static/favicon.svg` (tanda merek dari `docs/favicon.svg` di atas ubin biru) dengan PNG 32/180/512 px plus `favicon.ico` yang dihasilkan `bun run favicon:render` (Chromium Playwright, tanpa pustaka gambar); ganti berkas SVG-nya lalu jalankan ulang perintah itu. `favicon.ico` melayani klien yang mengabaikan `<link rel="icon">` dan langsung meminta `/favicon.ico` (halaman Swagger di `/docs`, Safari, crawler). Favicon **per tema** diunggah dari kolom Favicon di editor yang sama (PNG/SVG/ICO persegi; berkas publik `theme-favicon` → `assets.favicon`) dan menggantikan yang baku sebagai `<link rel="icon">` saat tema itu aktif. SVG disajikan dengan CSP `sandbox` sehingga skrip di dalamnya tidak pernah jalan.

**Yang tidak boleh dilakukan tema** (§4.8): mengganti implementasi komponen, menambah atau mengubah route, mengubah data atau perilaku, dan mem-bypass RBAC. Tema boleh menetapkan nilai baku varian komponen; tidak boleh menulis ulang komponennya.

---

## 6. Status implementasi

**Tersedia sejak M2:** komponen enam layout terdaftar (`apps/web/src/lib/layouts/*`), pemetaan tiga set ikon (`apps/web/src/lib/icons/*`), font self-hosted lewat `@fontsource`, resolusi tema/mode/layout saat SSR, pemilih tema tanpa JavaScript (`/theme`) dengan pratinjau SVG yang dihasilkan dari token + layout tema, dan tema/layout/set ikon dari modul (lihat `docs/MODULES.md`). `bun run theme:validate` memeriksa tema core **dan** modul, cakupan set ikon, serta kontrak region layout.

**Tersedia sejak 2026-09-08:** editor tema dari UI admin (L-24, §5a) — tema kustom per tenant/global tersimpan di database, divalidasi kontras sebelum disimpan, berlaku tanpa deploy.

**Belum:** aset merek untuk tema **berkas** (`logo.svg`, `favicon.svg`, `preview.png` di folder tema — pratinjau saat ini digenerate; tema kustom sudah bisa membawa logo **dan favicon** lewat unggahan, §5a), allowlist `themes.enabled` saat build (L-15; sekarang semua tema terdaftar ikut ter-bundle).

## 7. Catatan lama

Token, manifest, registry, dan validator sudah lengkap dan terverifikasi. Yang menunggu kerangka aplikasi ada:

- **Aset merek per tema** (`logo.svg`, `favicon.svg`, `preview.png`) — manifest sudah merujuknya; berkasnya dibuat saat identitas visual proyek ditetapkan.
- **Komponen layout** (`.svelte`) untuk enam layout terdaftar — registry sudah mendefinisikan kontrak dan region-nya.
- **Berkas pemetaan ikon** per set — daftar nama semantiknya sudah final, pemetaan ke glyph dibuat saat pustaka ikon dipasang.
- **Berkas font yang di-host sendiri** beserta `@font-face`-nya.

Keempatnya adalah pekerjaan M2 (§9 Rencana Rilis). Kontraknya sudah dikunci lebih dulu, jadi pekerjaan itu tinggal mengisi, bukan memutuskan.
