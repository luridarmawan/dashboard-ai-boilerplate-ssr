# Roadmap Pengembangan

| | |
|---|---|
| **Sumber kebutuhan** | [`PRD.md`](./PRD.md) — kebutuhan fungsional (FR-A…FR-R), kriteria terima §8, rencana rilis §9 |
| **Dokumen terkait** | [`THEMES.md`](./THEMES.md) — tema bawaan (sudah selesai, lihat M2) |
| **Asumsi tim** | **2 developer** yang bisa mengerjakan backend maupun frontend, penuh waktu |
| **Estimasi** | Dalam **person-week (pw)** dan rentang, bukan tanggal. Kalibrasi ulang setelah M0 selesai — M0 adalah pengukur kecepatan tim yang sesungguhnya |
| **Total kasar** | 31–43 pw ≈ **16–22 minggu kalender** dengan 2 developer |

Estimasi di sini adalah dugaan terdidik, bukan komitmen. Yang bisa dipegang adalah **urutannya** dan **gate keluarnya** — keduanya diturunkan dari risiko, bukan dari kenyamanan.

---

## 1. Prinsip penjadwalan

Tiga aturan yang menentukan urutan di bawah, dan layak diperdebatkan sekarang — bukan di tengah jalan.

**1. Risiko terbesar dibuktikan lebih dulu, sebelum ada yang dibangun di atasnya.**
Dua taruhan teknis terbesar proyek ini adalah (a) skema Drizzle netral-dialect lewat codegen, dan (b) kontrak modul yang sanggup dipakai dari repositori lain. Keduanya menyentuh setiap fitur setelahnya. Kalau (a) gagal di minggu ke-4, kita mengubah cakupan. Kalau gagal di minggu ke-20, kita menulis ulang. Karena itu **keduanya masuk M0**, bahkan sebelum autentikasi.

**2. Kontrak dikunci sebelum pemakainya banyak.**
Kontrak modul, amplop respons API, dan token tema semuanya lebih murah diubah saat ada satu pemakai daripada saat ada tiga puluh. Urutan M0 → M1 → M2 mengikuti ini: kontrak, lalu domain, lalu permukaan.

**3. Penjaga CI dinyalakan bertahap, bukan di akhir.**
Kriteria terima §8 bukan pemeriksaan sekali di ujung. Setiap milestone menyalakan pemeriksaan otomatisnya sendiri (§6 di bawah), sehingga regresi ketahuan pada hari ia masuk, bukan empat bulan kemudian.

---

## 2. Peta ketergantungan

```
                          ┌──────────────────────────┐
                          │  M0  Fondasi & Kontrak   │  ← gerbang risiko
                          │  db codegen · modul      │
                          └────────────┬─────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                     │
          ┌─────────▼─────────┐                 ┌─────────▼─────────┐
          │ M1  Identitas     │                 │ M2  UI/Tema/Layout│   ← bisa paralel
          │ auth·tenant·RBAC  │                 │ komponen·i18n     │      (2 developer)
          └─────────┬─────────┘                 └─────────┬─────────┘
                    └──────────────────┬──────────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │ M3  Konfigurasi & Kontrak│
                          │ config·OpenAPI·route baku│
                          └────────────┬─────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
          ┌─────────▼─────────┐                 ┌─────────▼─────────┐
          │ M4  Example       │                 │ M5  Modul AI      │   ← bisa paralel
          │ landing·SEO·email │                 │ chat·log·stream   │
          └─────────┬─────────┘                 └─────────┬─────────┘
                    └──────────────────┬──────────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │ M6  Modul lintas repo    │  ← gerbang janji produk
                          │ modgen·starter·CI guard  │
                          └────────────┬─────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │ M7  Pengerasan & Operasi │
                          └──────────────────────────┘
```

M1∥M2 dan M4∥M5 adalah satu-satunya paralelisasi yang aman. Memaksakan lebih dari itu berarti bekerja di atas kontrak yang belum stabil.

---

## 3. Milestone

Setiap milestone punya **gate keluar** — pernyataan yang bisa dijawab ya/tidak, bukan "kira-kira sudah". Milestone tidak dinyatakan selesai sebelum seluruh gate-nya hijau.

### M0 — Fondasi & Kontrak Modul · 4–6 pw

Gerbang risiko. Tidak ada fitur bisnis di sini; yang dibangun adalah hal-hal yang mahal diubah nanti.

**Isi:** struktur monorepo · `packages/db` dengan deskriptor netral + codegen per dialect (§4.3) · generator UUIDv7 tunggal, monotonik dalam milidetik (§4.3.1, O-6) · `packages/config` loader env tervalidasi (P-4) · `packages/module-kit` **sebagai paket nyata, bukan alias tsconfig** (§4.9 poin 1) · Elysia + SvelteKit tersambung lewat Eden Treaty · `modules:sync` + `modules.json` (G-2, G-10) · migrasi & seed (O-1…O-6) · **CI matriks tiga dialect: MySQL 8 + MariaDB 11 + PostgreSQL 16** (P-9) · kerangka Docker Compose dev + prod (Q-1…Q-5) · **dokumen kontrak modul** untuk developer (G-13, versi pertama)

**Gate keluar:**
1. `bun dev` menyalakan web + API; halaman kosong ter-SSR
2. Migrasi yang sama jalan bersih di **MySQL 8, MariaDB 11, dan PostgreSQL 16**; suite test (sekecil apa pun) lulus di ketiganya di CI, tanpa test yang di-skip pada dialect mana pun
3. Ada test yang membuktikan UUIDv7 **monotonik dalam milidetik yang sama** — sifat yang nanti diandalkan paginasi cursor (N-5), jadi jauh lebih murah diuji sekarang
4. Satu modul dummy menyumbang tabel + route API + halaman + menu, **tanpa mengubah berkas core** — diperiksa `git diff`
5. **Satu modul dummy kedua dipasang dari repositori git terpisah** lewat `modules:add`, dan berfungsi sama
6. `compose.prod.yml` menyajikan halaman di balik Caddy dengan TLS

> **Gate 5 sering ditunda orang ke akhir proyek. Jangan.** Kalau `@core/*` telanjur jadi alias tsconfig, memperbaikinya di M6 berarti menyentuh setiap impor di setiap modul. Di M0, biayanya satu hari.

**Titik keputusan:** bila codegen lintas-dialect terbukti terlalu mahal di sini, turunkan cakupan **sekarang** — ke keluarga MySQL saja (MySQL + MariaDB, yang jauh lebih dekat satu sama lain daripada ke PostgreSQL), atau pertimbangkan Kysely (§10). Keputusan ini murah di M0 dan mahal di mana pun setelahnya.

---

### M1 — Identitas · 5–7 pw

**Isi:** auth (A-1…A-7, A-10, A-12) — Argon2id, sesi cookie `httpOnly`, CSRF menyeluruh, verifikasi email, reset password · tenancy (B-0…B-5) · RBAC (C-1…C-7) · CRUD user/group/client + profil (FR-D) · adapter sesi & rate limit versi `database` (Keputusan M)

**Gate keluar:**
1. Login → kelola user → atur izin group → ganti tenant, seluruhnya berfungsi
2. Ada test yang membuktikan request lintas-origin ditolak pada endpoint yang mengubah state (§8 #10)
3. Ada test yang membuktikan **query tanpa filter tenant tidak bisa lolos** — penjaga B-3 bekerja di lapisan data, bukan di handler
4. `--scale api=3` **tanpa Redis**: login dan CRUD berfungsi di ketiga instance tanpa sticky session

> Gate 3 adalah konsekuensi langsung dari Keputusan N (tenancy per kolom). Tanpa batas fisik database, satu-satunya yang mencegah kebocoran lintas-tenant adalah kode — jadi itu harus diuji, bukan diasumsikan.

---

### M2 — Kerangka UI, Tema, & Layout · 6–8 pw

Bisa berjalan paralel dengan M1 setelah M0 selesai.

**Sudah selesai sebelum milestone dimulai:** token, manifest, registry ikon & layout, dan validator empat tema bawaan — lihat [`THEMES.md`](./THEMES.md). Yang tersisa adalah mengisi, bukan memutuskan.

**Isi:** komponen shadcn-svelte (L-1) · **DataTable** (L-16) dan **FormBuilder** (L-17) — dua komponen terbesar di proyek ini, sisihkan waktunya · komponen `<Icon>` + pemetaan tiga set ikon (L-5) · enam komponen layout terdaftar (L-6…L-8) · resolusi tema & varian layout saat SSR (L-11) · pemilih tema tanpa JavaScript (L-12) · i18n (K-1…K-7) · menu terfilter izin (F-1…F-4) · aksesibilitas (L-21) · font & aset merek

**Gate keluar:**
1. Empat tema bisa dipilih; berpindah tema mengubah warna, ikon, **dan** layout
2. Halaman pertama ter-render bertema benar **tanpa kedipan dan tanpa pergeseran tata letak**, termasuk untuk pengunjung anonim
3. Satu halaman mendeklarasikan `layoutVariant: 'wide'` dan tampil beda, sementara halaman lain tidak berubah
4. `node packages/ui-theme/validate.mjs` hijau di CI
5. Satu layout kustom didaftarkan dari luar core dan dipakai — **tanpa satu halaman pun diubah**
6. Dashboard berfungsi dengan JavaScript dimatikan: login, satu alur CRUD, pemilih tema, pemilih bahasa

---

### M3 — Konfigurasi, Kontrak API, & Halaman Baku · 3–4 pw

**Isi:** konfigurasi runtime + form ter-generate (FR-E) · adapter cache versi `database` (E-5) · resolusi landing/home route (F-5…F-7, §4.7) · OpenAPI runtime + typed client (FR-N) · observability dasar (M-1…M-5)

**Gate keluar:**
1. Admin mengubah setelan, tema baku, dan landing page dari UI — berlaku **tanpa restart**, dan terlihat oleh ketiga instance
2. `/openapi.json` cocok dengan perilaku nyata; klien typed terkompilasi tanpa error
3. Route baku yang menunjuk modul nonaktif jatuh ke fallback aman, bukan 404 di `/`

---

### M4 — Modul `Example` & sisi publik · 3–4 pw

Bisa paralel dengan M5.

**Isi:** modul `Example` (FR-R) · landing komersil dengan data dari DB (§4.6) · SEO per halaman + sitemap (R-4) · form kontak tanpa JavaScript (R-5) · email + outbox (FR-J)

**Gate keluar:**
1. `/` menyajikan landing komersil ter-SSR pada instalasi bersih
2. Lighthouse **SEO ≥ 90** dan Performance ≥ 90 pada landing; terindeks dengan JavaScript dimatikan
3. Form kontak bekerja tanpa JavaScript, tersimpan, dan emailnya masuk outbox
4. `Example` dinonaktifkan → aplikasi tetap utuh, `/` jatuh ke fallback

> Milestone ini adalah uji pertama titik perluasan 13 dan 14 (halaman publik & tema). Kalau kontraknya kurang, ketahuannya di sini.

---

### M5 — Modul `AI` · 3–4 pw

Bisa paralel dengan M4.

**Isi:** chat streaming end-to-end (H-1…H-9) · riwayat percakapan · render markdown tersanitasi · log AI asinkron · **dibangun sebagai modul**, bukan bagian core

**Gate keluar:**
1. Streaming berjalan provider → API → SvelteKit → UI, dengan pembatalan yang benar saat tab ditutup
2. Setiap panggilan tercatat dengan token & latensi terisi, dan pencatatan **tidak menahan** jalur panas
3. Menonaktifkan modul AI untuk satu tenant menghilangkan menu, route, dan tool-nya — sisa aplikasi utuh
4. Melepasnya dari `modules.json` membuat aplikasi tetap ter-build dan berjalan **tanpa jejak AI**

> Ini uji terberat kontrak modul: fitur besar yang menyentuh titik perluasan 1–12. Gate 4 yang paling sering gagal diam-diam — sisa impor atau entri menu yatim.

---

### M6 — Modul lintas repositori · 3–4 pw

Gerbang janji produk. Setelah ini, "developer bisa membangun modul sendiri" berhenti jadi klaim.

**Isi:** `bun modgen` lengkap (G-4) · starter modul standalone (G-12) · `modules:add` + penguncian `ref` (G-10) · pemeriksaan `engines.core` (G-11) · **penjaga CI "tanpa ubah core"** (G-6) · UI admin modul (G-14) · dokumen "Membangun Modul Pertama Anda" (G-13, versi final)

**Gate keluar:**
1. Modul dibuat lewat `bun modgen` dan langsung berfungsi — tabel, menu, izin, CRUD, terjemahan
2. Modul dibuat di **repo terpisah**, di-build & dites di sana, dipasang lewat git URL, berfungsi penuh
3. CI **menolak** perubahan yang menyentuh berkas core saat menambah modul
4. Menghapus folder modul + `modules:sync` → aplikasi tetap benar, tanpa route yatim atau tema hilang
5. Seseorang di luar tim inti mengikuti dokumen G-13 dan berhasil sampai modulnya jalan — **tanpa bertanya**

> Gate 5 tidak bisa diotomasi dan sering dilewati. Ia satu-satunya yang benar-benar menguji apakah dokumennya cukup.

---

### M7 — Pengerasan & Operasi · 4–6 pw

**Isi:** MCP server & client (FR-I) · rate limit terdistribusi · audit log & retensi (M-2, M-3, M-6, M-7) · backup/restore teruji (O-7, Q-8) · deploy tanpa downtime (Q-12) · preflight (Q-13) · adapter Redis opsional · panduan deploy VPS (Q-10) · dokumentasi (P-10)

**Gate keluar:** seluruh 25 kriteria terima §8 hijau, termasuk yang hanya bisa diuji manual:
1. Dari VPS bersih ke HTTPS dalam < 15 menit mengikuti panduan, **tanpa langkah tak tertulis**
2. Backup diambil → database dihapus → restore → aplikasi utuh. Dijalankan, bukan diasumsikan
3. Stack stabil di 2 vCPU / 4 GB dengan RAM idle < 1,5 GB
4. Suite yang sama lulus dengan **dan** tanpa Redis

---

## 4. Jalur kritis & paralelisasi

**Jalur kritis:** M0 → M1 → M3 → M6 → M7. Ini yang menentukan tanggal selesai.

| Fase | Developer A | Developer B |
|---|---|---|
| 1 | M0 — db codegen, deskriptor, migrasi | M0 — module-kit, `modules:sync`, CI, compose |
| 2 | M1 — auth, tenancy, RBAC | M2 — komponen, DataTable, FormBuilder |
| 3 | M1 — CRUD user/group/client | M2 — tema, layout, ikon, i18n |
| 4 | M3 — konfigurasi, OpenAPI, observability | M3 — form ter-generate, resolusi route |
| 5 | M5 — modul AI | M4 — modul Example, landing, SEO, email |
| 6 | M6 — modgen, starter, CI guard | M6 — UI admin modul, dokumen |
| 7 | M7 — MCP, rate limit, audit | M7 — backup, deploy, preflight, panduan |

Dengan **1 developer**, kalikan kalender ±1,8× (bukan 2× — hilangnya biaya koordinasi menutup sebagian). Dengan **3 developer**, jalur kritis tidak banyak berubah; yang bertambah adalah kemampuan menyerap P1 lebih awal.

---

## 5. Gate keputusan

Pertanyaan terbuka §11.2, dipetakan ke kapan jawabannya benar-benar dibutuhkan.

| # | Pertanyaan | Dibutuhkan paling lambat | Bila belum dijawab |
|---|---|---|---|
| 1 | Gaya landing `Example` (company profile / e-commerce) | **M4, sebelum mulai** | Memblokir — bentuk tabel & halamannya berbeda |
| 2 | Aset merek per tema (logo, favicon, pratinjau) | M2 | Pakai placeholder; tidak memblokir |
| 3 | Pemilik registry harga model AI | M5 | Hardcode dulu di tabel konfigurasi; pindah belakangan murah |
| 4 | Lisensi rilis template | Sebelum rilis | Tidak memblokir pengembangan |

Hanya #1 yang benar-benar mengikat. Sisanya bisa berjalan dengan nilai sementara.

**Sudah diputuskan dan tidak lagi memblokir M0:** image baku `compose.prod.yml` adalah **MySQL 8**; MariaDB 11 tetap tier-1 tapi lewat job CI-nya sendiri (§4.3, P-9).

---

## 6. Penjaga CI, dinyalakan bertahap

Kriteria terima §8 bukan pemeriksaan sekali di ujung. Kolom kanan adalah kapan pemeriksaannya mulai wajib hijau.

| Pemeriksaan otomatis | Kriteria §8 | Nyala di |
|---|---|---|
| Matriks test MySQL 8 + MariaDB 11 + PostgreSQL 16 | #2 | M0 |
| DDL menyatakan charset & collation eksplisit (tidak mewarisi default server) | §4.3 | M0 |
| `git diff` menolak perubahan core saat menambah modul | #11, #18 | M0 (dasar) → M6 (penuh) |
| Modul dari repo terpisah ter-build & jalan | #13 | M0 (dummy) → M6 (penuh) |
| Grep artefak build: tidak ada rahasia di bundle klien | #6 | M0 |
| Lint: warna literal & impor ikon langsung ditolak | L-2, L-5 | M2 |
| `packages/ui-theme/validate.mjs` — kontras AA semua tema | #17, #21 | M2 |
| Uji aksesibilitas per kombinasi layout × tema | #17 | M2 |
| Suite E2E tanpa JavaScript | #5 | M2 |
| `bun check` — klien typed vs OpenAPI | #4 | M3 |
| Test CSRF lintas-origin ditolak | #10 | M1 |
| Test kebocoran lintas-tenant | B-3 | M1 |
| Lighthouse landing (SEO & Performance ≥ 90) | #8 | M4 |
| `--scale api=3` **tanpa Redis** | #3 | M1 (dasar) → M7 (penuh) |
| Audit dependensi | #7 | M0 |

---

## 7. Definisi selesai (per perubahan, bukan per milestone)

Sebuah perubahan dianggap selesai bila:

1. Lint, format, dan type-check lulus (P-7)
2. Ada test pada tingkat yang sesuai — unit untuk logika murni, integrasi untuk yang menyentuh DB
3. Endpoint baru punya skema TypeBox, sehingga otomatis muncul benar di OpenAPI (N-1)
4. Tidak ada string yang di-hardcode di komponen (§7 i18n)
5. Tidak ada warna literal atau impor glyph langsung (L-2, L-5)
6. Query yang menyentuh tabel ber-tenant lewat helper repository, bukan query langsung (B-3)
7. Bila mengubah perilaku yang tertulis di PRD, **PRD ikut diperbarui pada PR yang sama** — dokumen yang basi lebih berbahaya daripada tidak ada dokumen

---

## 8. Sesudah MVP

Urutan yang disarankan untuk P1, berdasarkan apa yang paling cepat terasa oleh pemakai template:

1. **UI admin modul + editor tema** (G-14, L-24) — dua hal yang paling sering diminta setelah orang mulai memakai
2. **Notifikasi dalam aplikasi** (J-4) — backend-nya sudah ada sebagian lewat outbox
3. **Upload berkas + adapter S3** (Q-9)
4. **Multi-provider AI + dashboard biaya** (H-10, H-15)
5. **Metrik Prometheus** (M-6)

P2 (2FA, SSO tambahan, impersonasi, job queue, marketplace modul) sebaiknya menunggu pemakaian nyata. Menambahkannya lebih awal berarti menebak kebutuhan yang belum ada — persis risiko "cakupan membengkak" di §10 PRD.

---

## 9. Cara membaca kemajuan

Jangan mengukur dengan persentase task. Ukur dengan **berapa gate keluar yang sudah hijau** dan **berapa penjaga CI yang sudah menyala**. Keduanya biner, tidak bisa ditawar, dan tidak bisa "90% selesai".

Kalau sebuah milestone lewat dari estimasi lebih dari 50%, hentikan dan periksa: biasanya penyebabnya bukan kecepatan menulis kode, melainkan sebuah kontrak yang belum benar dan sedang ditambal berulang kali. Itu sinyal untuk kembali ke §4.5 atau §4.8, bukan untuk menambah jam kerja.
