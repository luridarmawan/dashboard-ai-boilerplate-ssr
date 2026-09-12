# Roadmap Pengembangan

| | |
|---|---|
| **Sumber kebutuhan** | [`PRD.md`](./PRD.md) — kebutuhan fungsional (FR-A…FR-R), kriteria terima §8, rencana rilis §9 |
| **Dokumen terkait** | [`THEMES.md`](./THEMES.md) — tema bawaan (sudah selesai, lihat M2) |
| **Asumsi tim** | **2 developer** yang bisa mengerjakan backend maupun frontend, penuh waktu |
| **Estimasi** | Dalam **person-week (pw)** dan rentang, bukan tanggal. Kalibrasi ulang setelah M0 selesai — M0 adalah pengukur kecepatan tim yang sesungguhnya |
| **Total kasar** | 31–42 pw ≈ **16–22 minggu kalender** dengan 2 developer |

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

**Invarian cakupan:** M0–M7 memuat kebutuhan **P0 saja**. Setiap item P1/P2 hidup di §8, dan hanya di sana. Sebuah item yang muncul di keduanya bukan penekanan — itu sinyal cakupan sedang membengkak (§10 PRD), dan yang dihapus adalah salinannya di milestone. Rujukan grup (`FR-X`) tidak dipakai di milestone karena ia diam-diam menyapu anggota P1/P2; yang ditulis adalah rentang eksplisit.

### M0 — Fondasi & Kontrak Modul · 5–7 pw

Gerbang risiko. Tidak ada fitur bisnis di sini; yang dibangun adalah hal-hal yang mahal diubah nanti.

**Isi:** struktur monorepo · `packages/db` dengan deskriptor netral + codegen per dialect (§4.3) · generator UUIDv7 tunggal, monotonik dalam milidetik (§4.3.1, O-6) · `packages/config` loader env tervalidasi (P-4) · `packages/module-kit` **sebagai paket nyata, bukan alias tsconfig** (§4.9 poin 1) · Elysia + SvelteKit tersambung lewat Eden Treaty · `modules:sync` + `modules.json` (G-2, G-10) · bentuk modul, impor lewat paket, isolasi kegagalan modul, validasi namespace (G-1, G-3, G-7, G-9) · **event bus + penjadwal core aman multi-instance (G-17, G-18)** · migrasi & seed (O-1…O-6) · **CI matriks tiga dialect: MySQL 8 + MariaDB 11 + PostgreSQL 16** (P-9) · harness test unit + integrasi dengan DB nyata via testcontainer (P-8 bagian pertama — rantai E2E penuh menyusul di M5) · kerangka Docker Compose dev + prod, termasuk restart otomatis, rotasi log, dan volume unggahan (Q-1…Q-7, Q-9) · **dokumen kontrak modul** untuk developer (G-13, versi pertama)

**Gate keluar:**
1. `bun dev` menyalakan web + API; halaman kosong ter-SSR
2. Migrasi yang sama jalan bersih di **MySQL 8, MariaDB 11, dan PostgreSQL 16**; suite test (sekecil apa pun) lulus di ketiganya di CI, tanpa test yang di-skip pada dialect mana pun
3. Ada test yang membuktikan UUIDv7 **monotonik dalam milidetik yang sama** — sifat yang nanti diandalkan paginasi cursor (N-5), jadi jauh lebih murah diuji sekarang
4. Satu modul dummy menyumbang tabel + route API + halaman + menu, **tanpa mengubah berkas core** — diperiksa `git diff`
5. **Satu modul dummy kedua dipasang dari repositori git terpisah** lewat `modules:add`, dan berfungsi sama
6. Sebuah job terjadwal yang didaftarkan modul dummy berjalan **tepat sekali** dengan `--scale api=3`, dan sebuah event core yang diterbitkan memanggil hook modul itu — keduanya dibuktikan test, bukan diasumsikan
7. `compose.prod.yml` menyajikan halaman di balik Caddy dengan TLS

> **Kenapa penjadwal masuk M0 (gate 6), bukan M7 bersama operasi.** Empat kebutuhan P0 sudah mengandaikannya sejak awal — pembersihan `sessions`, worker outbox (J-2), retensi log AI (M-3), dan backup terjadwal (Q-8) — dan sifat yang mahal itu bukan "menjalankan job", melainkan **menjalankannya sekali saat instance-nya tiga**. Penjadwal naif akan lolos di dev satu proses dan baru salah di produksi. Sama seperti gate 5: ini kontrak, dan kontrak tidak boleh ditemukan setelah ada pemakainya.

> **Gate 5 sering ditunda orang ke akhir proyek. Jangan.** Kalau `@core/*` telanjur jadi alias tsconfig, memperbaikinya di M6 berarti menyentuh setiap impor di setiap modul. Di M0, biayanya satu hari.

**Titik keputusan:** bila codegen lintas-dialect terbukti terlalu mahal di sini, turunkan cakupan **sekarang** — ke keluarga MySQL saja (MySQL + MariaDB, yang jauh lebih dekat satu sama lain daripada ke PostgreSQL), atau pertimbangkan Kysely (§10). Keputusan ini murah di M0 dan mahal di mana pun setelahnya.

---

### M1 — Identitas · 5–7 pw

**Isi:** auth (A-1…A-7, A-10, A-12) — Argon2id, sesi cookie `httpOnly`, CSRF menyeluruh, verifikasi email, reset password · tenancy (B-0…B-5) · RBAC (C-1…C-7) · CRUD user/group/client + profil (D-1…D-4) · adapter sesi & rate limit versi `database` (Keputusan M)

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

**Isi:** komponen shadcn-svelte (L-1) · **DataTable** (L-16) dan **FormBuilder** (L-17) — dua komponen terbesar di proyek ini, sisihkan waktunya · komponen `<Icon>` + pemetaan tiga set ikon (L-5) · enam komponen layout terdaftar (L-6…L-8) · resolusi tema & varian layout saat SSR (L-11) · pemilih tema tanpa JavaScript (L-12) · i18n (K-1…K-7) · menu terfilter izin (F-1…F-4) · registry widget dashboard (G-19) · aksesibilitas (L-21) · font & aset merek

**Gate keluar:**
1. Empat tema bisa dipilih; berpindah tema mengubah warna, ikon, **dan** layout
2. Halaman pertama ter-render bertema benar **tanpa kedipan dan tanpa pergeseran tata letak**, termasuk untuk pengunjung anonim
3. Satu halaman mendeklarasikan `layoutVariant: 'wide'` dan tampil beda, sementara halaman lain tidak berubah
4. `node packages/ui-theme/validate.mjs` hijau di CI
5. Satu layout kustom didaftarkan dari luar core dan dipakai — **tanpa satu halaman pun diubah**
6. Dashboard berfungsi dengan JavaScript dimatikan: login, satu alur CRUD, pemilih tema, pemilih bahasa

---

### M3 — Konfigurasi, Kontrak API, & Halaman Baku · 3–4 pw

**Isi:** konfigurasi runtime + form ter-generate (E-1…E-8) · adapter cache versi `database` (E-5) · resolusi landing/home route (F-5…F-7, §4.7) · OpenAPI runtime + typed client (N-1…N-7) · observability dasar (M-1, M-4, M-5) · **penyamaran data sensitif di logger (M-7)** · audit log (M-2) · aktif/nonaktif modul per tenant (G-8) — gate M5 #3 bergantung padanya

**Gate keluar:**
1. Admin mengubah setelan, tema baku, dan landing page dari UI — berlaku **tanpa restart**, dan terlihat oleh ketiga instance
2. `/openapi.json` cocok dengan perilaku nyata; klien typed terkompilasi tanpa error
3. Route baku yang menunjuk modul nonaktif jatuh ke fallback aman, bukan 404 di `/`

---

### M4 — Modul `Example` & sisi publik · 3–4 pw

Bisa paralel dengan M5.

**Isi:** modul `Example` (R-1…R-8) · landing komersil dengan data dari DB (§4.6) · SEO per halaman + sitemap (R-4) · form kontak tanpa JavaScript (R-5) · email + outbox (J-1…J-3)

**Gate keluar:**
1. `/` menyajikan landing komersil ter-SSR pada instalasi bersih
2. Lighthouse **≥ 90 pada keempat kategori** di landing — Performance, Accessibility, Best Practices, **dan SEO** (persis kriteria §8 #8, jangan disempitkan); terindeks dengan JavaScript dimatikan
3. Form kontak bekerja tanpa JavaScript, tersimpan, dan emailnya masuk outbox
4. `Example` dinonaktifkan → aplikasi tetap utuh, `/` jatuh ke fallback

> Milestone ini adalah uji pertama titik perluasan 13 dan 14 (halaman publik & tema). Kalau kontraknya kurang, ketahuannya di sini.

---

### M5 — Modul `AI` · 3–4 pw

Bisa paralel dengan M4.

**Isi:** chat streaming end-to-end (H-1…H-9) · riwayat percakapan · render markdown tersanitasi · log AI asinkron · **dibangun sebagai modul**, bukan bagian core · **E2E penuh landing → login → CRUD → chat (P-8)** — baru bisa ditulis di sini karena chat-nya baru ada

**Gate keluar:**
1. Streaming berjalan provider → API → SvelteKit → UI, dengan pembatalan yang benar saat tab ditutup
2. Setiap panggilan tercatat dengan token & latensi terisi, dan pencatatan **tidak menahan** jalur panas
3. Menonaktifkan modul AI untuk satu tenant menghilangkan menu, route, dan tool-nya — sisa aplikasi utuh
4. Melepasnya dari `modules.json` membuat aplikasi tetap ter-build dan berjalan **tanpa jejak AI**

> Ini uji terberat kontrak modul: fitur besar yang menyentuh titik perluasan 1–12. Gate 4 yang paling sering gagal diam-diam — sisa impor atau entri menu yatim.

---

### M6 — Modul lintas repositori · 3–4 pw

Gerbang janji produk. Setelah ini, "developer bisa membangun modul sendiri" berhenti jadi klaim.

**Isi:** `bun modgen` lengkap (G-4) · starter modul standalone (G-12) · `modules:add` + penguncian `ref` (G-10) · pemeriksaan `engines.core` (G-11) · **penjaga CI "tanpa ubah core"** (G-6) · **16 titik perluasan tersedia seluruhnya, masing-masing dengan contoh yang jalan (G-5)** · dokumen "Membangun Modul Pertama Anda" (G-13, versi final)

**Gate keluar:**
1. Modul dibuat lewat `bun modgen` dan langsung berfungsi — tabel, menu, izin, CRUD, terjemahan
2. Modul dibuat di **repo terpisah**, di-build & dites di sana, dipasang lewat git URL, berfungsi penuh
3. CI **menolak** perubahan yang menyentuh berkas core saat menambah modul
4. Menghapus folder modul + `modules:sync` → aplikasi tetap benar, tanpa route yatim atau tema hilang
5. Seseorang di luar tim inti mengikuti dokumen G-13 dan berhasil sampai modulnya jalan — **tanpa bertanya**

> Gate 5 tidak bisa diotomasi dan sering dilewati. Ia satu-satunya yang benar-benar menguji apakah dokumennya cukup.

---

### M7 — Pengerasan & Operasi · 3–4 pw

**Isi:** **retensi log & audit (M-3)** — fasilitas audit log-nya sendiri sudah ada sejak M3, yang tersisa di sini kebijakan retensinya · backup/restore teruji (O-7, Q-8) · panduan deploy VPS (Q-10) · dokumentasi (P-10) · **pembuktian manual kriteria §8** — VPS bersih, restore, stabilitas 2 vCPU / 4 GB

Yang **tidak** ada di sini, dan sengaja: MCP, systemd, deploy tanpa downtime, preflight, resource limit, CD contoh, dan adapter Redis. Semuanya P1/P2 — rumahnya §8 (butir 2, 3, dan 7), dan ID-nya sengaja tidak ditulis ulang di sini supaya milestone ini tetap terbaca P0-saja oleh pemeriksaan otomatis. Estimasinya turun dari 4–6 pw menjadi 3–4 pw karena itu.

**Gate keluar — ini titik rilis MVP:** seluruh 25 kriteria terima §8 hijau, termasuk yang hanya bisa diuji manual:
1. Dari VPS bersih ke HTTPS dalam < 15 menit mengikuti panduan, **tanpa langkah tak tertulis**
2. Backup diambil → database dihapus → restore → aplikasi utuh. Dijalankan, bukan diasumsikan
3. Stack stabil di 2 vCPU / 4 GB dengan RAM idle < 1,5 GB
4. Suite yang sama lulus dengan **dan** tanpa Redis

---

## 4. Jalur kritis & paralelisasi

**Jalur kritis:** M0 → M1 → M3 → M6 → M7. Ini yang menentukan tanggal selesai.

| Fase | Developer A | Developer B |
|---|---|---|
| 1 | M0 — db codegen, deskriptor, migrasi | M0 — module-kit, `modules:sync`, event bus & penjadwal, CI, compose |
| 2 | M1 — auth, tenancy, RBAC | M2 — komponen, DataTable, FormBuilder |
| 3 | M1 — CRUD user/group/client | M2 — tema, layout, ikon, i18n |
| 4 | M3 — konfigurasi, OpenAPI, observability | M3 — form ter-generate, resolusi route |
| 5 | M5 — modul AI | M4 — modul Example, landing, SEO, email |
| 6 | M6 — modgen, starter, CI guard | M6 — contoh 16 titik perluasan (G-5), dokumen |
| 7 | M7 — retensi log, uji stabilitas & VPS bersih | M7 — backup/restore teruji, panduan deploy |

Dengan **1 developer**, kalikan kalender ±1,8× (bukan 2× — hilangnya biaya koordinasi menutup sebagian). Dengan **3 developer**, jalur kritis tidak banyak berubah; yang bertambah adalah kemampuan menyerap P1 lebih awal.

---

## 5. Gate keputusan

Pertanyaan terbuka §11.2, dipetakan ke kapan jawabannya benar-benar dibutuhkan.

| # | Pertanyaan | Dibutuhkan paling lambat | Bila belum dijawab |
|---|---|---|---|
| 1 | Gaya landing `Example` (company profile / e-commerce) | **M4, sebelum mulai** | Memblokir — bentuk tabel & halamannya berbeda |
| 2 | Aset merek per tema (logo, favicon, pratinjau) | M2 | Pakai placeholder; tidak memblokir |
| 3 | Pemilik registry harga model AI | M5 | Hardcode dulu di tabel konfigurasi; pindah belakangan murah |
| 4 | Lisensi rilis template | Sebelum rilis | **Diputuskan 2026-09-09, diubah 2026-09-10: MIT** — `LICENSE`, `"license": "MIT"` di semua workspace (PRD §11.1) |

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
| Lighthouse landing ≥ 90 — Performance, Accessibility, Best Practices, SEO | #8 | M4 |
| `--scale api=3` **tanpa Redis** | #3 | M1 (dasar) → M7 (penuh) |
| Job terjadwal berjalan tepat sekali di bawah `--scale api=3` | D1, G-18 | M0 |
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

Ini **satu-satunya rumah** untuk P1/P2 (invarian §3). Urutan yang disarankan, berdasarkan apa yang paling cepat terasa oleh pemakai template:

1. **UI admin modul + editor tema** (G-14, L-24) — **selesai 2026-09-08.** Halaman Modul menampilkan sumber, versi, path, deskripsi, kontribusi tiap modul (dihitung `modules:sync`), dan kesehatan (status job terakhir dari `scheduler_jobs`, hook yang gagal di instance ini); editor tema `/themes` merakit tema kustom dari token + set ikon + layout terdaftar, divalidasi kontras AA, tersimpan di tabel `themes` dan berlaku tanpa deploy ([`THEMES.md` §5a](./THEMES.md)). Unggah logo menyusul bersama Q-16 (butir 5)
2. **MCP server & client** (FR-I) — **selesai 2026-09-08** ([`MCP.md`](./MCP.md)): kontrak tool (titik perluasan 8), MCP server `/v1/mcp` dengan SDK resmi (I-1, I-2, I-3) di atas registry `apps/api/src/tools.ts`, token API bearer (A-4, sebelumnya belum ada), MCP client di modul AI (I-4: `ai_mcps`/`ai_mcp_tools`, transport http/sse, tool eksternal masuk registry lewat *tool source* dan ikut ditawarkan di chat AI; I-5: UI `/m/ai/mcps`), dan I-6 dibuktikan test (`apps/api/test/integration/mcp.test.ts`, `tools.test.ts`, `modules/AI/test/integration/mcp-client.test.ts`). **Keputusan (dikonfirmasi 2026-09-08):** transport MCP hanya HTTP / Streamable HTTP (klien juga menerima SSE lama) — `stdio` dan `websocket` **tidak akan dibangun**; endpoint MCP server adalah satu endpoint JSON-RPC Streamable HTTP, bukan `POST /tools/list` dkk. seperti di Lampiran A PRD
3. **Preflight + deploy tanpa downtime** (Q-13, Q-12) — **selesai 2026-09-08** bersama systemd (Q-11) dan batas sumber daya (Q-14): `api preflight` (subperintah binary, `dc run --rm preflight`, `ExecStartPre` di systemd), `deploy/upgrade.sh` + `deploy/rollout.sh` (replika baru berdampingan → sehat → Caddy retry → yang lama dimatikan; dibuktikan `scripts/ci/rollout-proof.sh` dengan nol request gagal), `mem_limit`/`cpus` per service, `deploy/systemd/*.service` + `scripts/build-release.sh` ([`DEPLOY.md` §8](./DEPLOY.md)). Yang tidak masuk: upgrade image mysql/caddy tanpa downtime, dan rollout tanpa downtime di mode systemd
4. **Notifikasi dalam aplikasi** (J-4) — **selesai 2026-09-08**: tabel `notifications` (migrasi 0010), layanan `notify()` (`@app/api/notifications`: penerima eksplisit atau *fan-out* ke semua pemegang sebuah izin di tenant, pelaku dikecualikan), event `notification.created`, API `/v1/notifications` (daftar, hitung, tandai dibaca, tandai semua; selalu milik pemanggil di tenant aktif), bel di header semua layout dasbor + halaman `/notifications` tanpa JS, retensi notifikasi terbaca (`logs.notification_retention_days`). Produsen bawaan: token API dibuat → pemilik; modul di-toggle → pemegang `module.manage`; pesan kontak Example → pemegang `example.inquiry.read`. **Dropdown bel menyusul 2026-09-10**: `<details>` di shell (`apps/web/src/routes/(app)/+layout.svelte`) berisi lima notifikasi belum dibaca terbaru — membukanya, menandai satu dibaca, dan **tandai semua** semuanya form biasa ke aksi `/notifications`, jadi tetap jalan tanpa JavaScript (`use:dropdown` hanya menambah tutup-saat-klik-luar/Escape). Satu panggilan API memberi makan lonceng dan isinya sekaligus (`?unread=1&limit=5` mengembalikan total belum dibaca bersama barisnya), jadi shell tidak jadi lebih mahal dari sekadar hitungan. Dibuktikan lima cek di `scripts/m1-gate1-proof.ts` §7. Push/webhook keluar (J-5) sudah mendarat di P2 butir 2
5. **Fitur unggah berkas + adapter S3** (Q-16) — **selesai 2026-09-08**: paket `@core/storage` (adapter `local` di volume Q-9 dan `s3` lewat klien S3 bawaan Bun — AWS/MinIO/R2/Spaces, dipilih `STORAGE_DRIVER`), tabel `files` (migrasi 0011; metadata = data tenant, kunci objek `<clientId>/<yyyy>/<mm>/<id>.<ext>`), layanan `storeUpload()` di `@app/api/files` untuk modul (validasi ukuran & tipe dari **Pengaturan → Berkas**, endus magic bytes, refusal `content_mismatch`), API `/v1/files` (izin `file.*`, privat = pemilik/`file.read`, publik = anonim dengan tenant, SVG disajikan dengan CSP sandbox), preflight memeriksa volume atau bucket, dan pelunasan L-24: editor tema mengunggah logo → `themes.assets` → header semua shell ([`MODULES.md` §3](./MODULES.md), [`DEPLOY.md` §3](./DEPLOY.md), [`THEMES.md` §5a](./THEMES.md)). Menyusul sesudahnya: **UI favicon** di editor tema (`ThemeEditor.svelte` + `_assets.server.ts`, berkas publik `theme-favicon`) dan **avatar pengguna** (Profil → unggah/hapus, `POST /v1/users/profile/avatar`, maks 2 MB). Belum: pemindahan objek antar driver (local ↔ S3) — tidak ada perintah migrasinya, ganti driver berarti memindahkan bucket sendiri
6. **Multi-provider AI + dashboard biaya** (H-10, H-15) — **selesai 2026-09-08**: profil penyedia per tenant (`ai_providers`) dengan daftar model berharga (`ai_models`, migrasi 0012), dipilih per percakapan dari header chat atau dinamai di request (`provider`, `model`); biaya tiap panggilan dari baris harga model yang menjawab, kode penyedia tercatat di `ai_calls.provider`; halaman **Penyedia AI** (CRUD, key tersamar, uji `GET /models`), izin `ai.provider.*`; Pengaturan → AI tetap jadi penyedia implisit bila belum ada profil. **Analitik AI** (`/m/ai/analytics`): total, token per hari (grafik CSS), per penyedia/model, per pengguna, rentang 7/30/90 hari ([`AI.md`](./AI.md)). Menyusul sesudahnya: kuota per tenant/user (H-14, P2 butir 3), lampiran & threading pesan (H-11, H-12, P2 butir 7), dan **widget dasbor penggunaan** — sejak widget boleh menyebut path `data` (G-19), `/dashboard` menarik `/v1/m/ai/analytics?days=30` sebagai pengguna itu dan menyerahkannya sebagai prop ke `modules/AI/web/widgets/Usage.svelte`
7. **Adapter Redis** untuk sesi, cache, dan rate limit — **selesai 2026-09-08**, opsional per jenis state lewat `SESSION_DRIVER` / `CACHE_DRIVER` / `RATELIMIT_DRIVER` = `redis` + `REDIS_URL`; database tetap sumber kebenaran: sesi di-cache 60 s di depan tabel `sessions` dan diusir oleh setiap jalur tulis (logout, revoke-all, ganti/lepas tenant), rate limit memakai `INCR`+`PEXPIREAT` per jendela, dan setiap galat Redis jatuh kembali ke database (fail-open ke database, bukan ke "tanpa batas"). CI gate M7 menjalankan seluruh suite integrasi dengan ketiga driver `redis` + `TABLE_PREFIX` ([`DEPLOY.md` §3](./DEPLOY.md), `packages/auth/src/redis.ts`)
8. **Metrik Prometheus** (M-6) — **selesai 2026-09-08**: paket `@core/metrics` tanpa dependensi (counter/gauge/histogram + format teks 0.0.4), `GET /metrics` di root api (tidak diproksi Caddy; `METRICS_TOKEN` opsional, `METRICS_ENABLED`), laju request/latensi/error per route yang cocok, in-flight, pool DB, job penjadwal, hook modul, `app_info`, proses; modul AI menyumbang `ai_calls_total`/`ai_tokens_total`/`ai_cost_micro_total`; modul lain lewat `@app/api/metrics`; profil compose `monitoring` (Prometheus + `deploy/prometheus.yml` dengan DNS SD ke semua replika) ([`DEPLOY.md` §7a](./DEPLOY.md)); Grafana ter-provision (datasource + dashboard API 12 panel, `deploy/grafana/`) dan 7 aturan alert (`deploy/prometheus-rules.yml`) di profil yang sama. Alertmanager ikut di profil yang sama (2026-09-08; kanal email/Slack/Telegram/webhook diisi operator di `deploy/alertmanager.yml`)

P2 (2FA, SSO tambahan, impersonasi, job queue, marketplace modul) sebaiknya menunggu pemakaian nyata. Menambahkannya lebih awal berarti menebak kebutuhan yang belum ada — persis risiko "cakupan membengkak" di §10 PRD.

**P2 yang dikerjakan atas keputusan pemilik (2026-09-08)**, urutan berdasar nilai per usaha:

1. **Pipeline CD contoh** (Q-15) — **selesai**: `.github/workflows/deploy.yml` (build + push ke GHCR → SSH → `deploy/upgrade.sh --pull <tag>`), mode `--pull` di upgrade.sh ([`DEPLOY.md` §8d](./DEPLOY.md))
2. **Webhook keluar** (J-5) — **selesai**: tabel `webhooks` + `webhook_deliveries`, event inti tenant → POST bertanda tangan HMAC-SHA256 dengan retry 1m/5m/30m/2h/12h, halaman `/webhooks` (secret sekali tampil, ping uji, riwayat, coba lagi), retensi riwayat, metrik ([`WEBHOOKS.md`](./WEBHOOKS.md))
3. **Kuota AI per tenant/user** (H-14, B-6) — **selesai**: kuota token bulanan tenant dan per pengguna (Pengaturan → AI), saldo prabayar per tenant (`ai_credits` + `ai_credit_ledger`, migrasi 0014) yang dikurangi biaya tiap panggilan; ditolak 429 dengan alasan sebelum penyedia dipanggil; kartu Kuota & saldo + top-up di Analitik AI, sisa kuota di header chat ([`AI.md`](./AI.md))
4. **2FA TOTP + recovery codes** (A-11) — **selesai**: TOTP RFC 6238 tanpa dependensi (`@core/auth` `totp.ts`, diuji dengan vektor RFC), tabel `user_mfa` + `mfa_challenges` (migrasi 0015); Profil → Autentikasi dua faktor: siapkan (QR SVG di server + kunci manual), aktifkan dengan kode hidup (10 kode pemulihan sekali tampil, sesi lain diakhiri), buat ulang kode, matikan dengan kata sandi; login dua langkah tanpa JavaScript (`POST /v1/auth/login` → `mfaRequired` + challenge 5 menit, `POST /v1/auth/login/mfa` dengan TOTP atau kode pemulihan, 5 kode salah membakar challenge, anti-replay per langkah); admin `DELETE /v1/users/:id/mfa` untuk pemulihan lock-out
5. **Impersonasi user oleh superadmin** (D-6) — **selesai**: `POST /v1/users/:id/impersonate` (hanya superadmin; bukan diri sendiri/superadmin lain/nonaktif; 1 jam) membuka sesi atas nama target dengan kolom `sessions.impersonator_id` (migrasi 0016) dan mengirimnya lewat cookie kedua `crk_impersonate` — sesi admin sendiri tidak disentuh; permintaan berjalan sebagai target, `/v1/auth/me` menyebut `impersonator`; ubah kata sandi/2FA dan impersonasi bersarang ditolak 403 `impersonating`; penanda merah bernama pengguna yang diperankan di menu akun (`#account-menu`, kanan atas setiap halaman dasbor) dengan tombol Berhenti di dalamnya (`POST /v1/users/impersonate/stop` mencabut sesi + hapus cookie); tombol "Masuk sebagai …" di halaman detail pengguna dan tombol ikon di daftar pengguna (`/users`, di kanan tombol Ubah); audit `user.impersonate_start` / `user.impersonate_stop`; logout mengakhiri kedua sesi
6. **Floating chat button dengan konteks halaman** (H-13) — **selesai**: titik perluasan 11 mendapat `slot: 'shell'` (widget dirender di setiap halaman dasbor setelah layout, filter izin + modul aktif di server, komponen code-split); modul AI menyumbang `ai.floating_chat` (`web/widgets/FloatingChat.svelte`): tombol pojok kanan bawah (tanpa JS = tautan ke `/m/ai/chat`), panel streaming lewat jembatan yang sama, konteks halaman (breadcrumb, path, judul, teks tersorot) dikirim sebagai field `context` → pesan `system` kedua di API, tidak pernah disimpan ke riwayat; E2E Playwright menguji panel dari `/dashboard` ([`AI.md`](./AI.md), [`MODULES.md`](./MODULES.md))
7. **Lampiran pesan AI (H-11) dan threading (H-12)** — **selesai**: `POST /v1/m/ai/attachments` (berkas privat milik pengirim lewat Q-16, gambar/teks/CSV/JSON/MD ≤ 5 MB) + `attachments` di `chat/completions` (teks dikutip, gambar sebagai `image_url`), tabel `ai_attachments`; `ai_messages.parent_id` (migrasi 0017) dengan `parent_id`/`regenerate` di API, `x_messages`/`crk.messages` mengembalikan id tersimpan, backfill percakapan lama saat dibaca; halaman chat: klip lampiran, tombol Buat ulang / Ubah-lalu-cabang, navigasi versi ‹ 1/2 › (`?m=<id>`), helper murni `web/lib/thread.ts` ([`AI.md`](./AI.md))
8. **Dukungan RTL** (K-9) — **selesai**: arah tulisan diputuskan di server (`directionOf(locale)` di `@core/i18n`, bahasa Arab/Ibrani/Persia/Urdu dll. → `dir="rtl"` di `<html>` sebelum byte pertama, sejalan K-2); shell, layout bawaan, komponen UI, dan halaman modul memakai utilitas CSS logis Tailwind (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/e`) sehingga satu stylesheet melayani dua arah, ikon penunjuk arah berputar lewat `rtl:rotate-180`; **Pratinjau RTL** di halaman Bahasa (cookie `crk_dir`) memaksa `rtl` tanpa memasang terjemahan; gate M2 memeriksa `dir` dan ketiadaan kelas fisik di shell
9. **Registry/marketplace modul sederhana** (G-16) — **selesai**: katalog JSON `modules.catalog.json` (atau `MODULES_CATALOG_URL`/`MODULES_CATALOG_FILE`; skema + `compareCatalog`/`searchCatalog` di `@core/module-kit`), CLI `bun modules:search [teks]` dan `bun modules:install <Nama>` (menyelesaikan repo + ref terkunci → `modules:add`), `GET /v1/module/catalog` (izin `module.manage`) dan bagian *Katalog modul* di halaman Modul dengan status terpasang/pembaruan/tersedia/tidak cocok (G-11) serta perintah pasang apa adanya — memasang tetap tindakan waktu-build, bukan tombol runtime ([`MODULES.md` §7c](./MODULES.md))
10. **Queue pekerjaan ad-hoc** — **selesai**: tabel `queue_jobs` (migrasi 0018), `registerTask()`/`enqueue()` dari `@app/api/queue` (payload, prioritas, `runAt`/`delayMs`, `dedupeKey`, `maxAttempts`, `timeoutMs`), worker `core.queue.work` tiap 10 dtk + nudge dengan klaim UPDATE bersyarat (sekali per baris di multi-instance), backoff 10 dtk/1/5/30 mnt/2 jam lalu **dead-letter**, pemulihan lease kedaluwarsa, izin `queue.read|manage`, halaman `/queue` (filter status, Ulangi/hapus teraudit, daftar task), retensi `logs.queue_retention_days`, metrik `queue_jobs_total`/`queue_job_duration_seconds` ([`MODULES.md`](./MODULES.md) → Antrean pekerjaan dari modul)
11. **Masuk dengan Google** (A-8, P1; diminta pemilik 2026-09-09) — **selesai**: authorization code + PKCE sepenuhnya di server (`GET /v1/auth/google/start` → cookie `crk_oauth` di web → Google → `/auth/google/callback` → `POST /v1/auth/google-login`; client secret tidak pernah meninggalkan API), tabel `oauth_accounts` (migrasi 0019; tautan lewat `sub`, bukan email), Pengaturan → Keamanan: aktif/nonaktif, client id, secret, **buat akun otomatis** (flag A-8), **domain email yang diizinkan**; bootstrap `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` di `.env` (E-6); email terverifikasi yang sudah terdaftar ditautkan, akun Google otomatis memverifikasi email lokal (A-6), pengguna nonaktif/domain asing/email belum terverifikasi ditolak dengan kode `sso_*`, rate limit terpisah `oauth:ip:`, 2FA tetap berlaku (challenge yang sama dengan login kata sandi), audit `auth.login` `{sso:'google'}` / `auth.sso_linked` / `auth.sso_account_created`; tombol di halaman masuk hanya tautan (tanpa JS). SSO lain (GitHub, X, Microsoft) tetap P2
12. **Uninstall modul bersih** (G-15, P1; diminta pemilik 2026-09-09) — **selesai**: `bun modules:remove <Nama> [--yes|--keep-files|--dry-run]` melepas `modules.json`, submodule (+`.gitmodules`, `.git/modules`, pengecualian `biome.json`) atau folder lokal, `bun install` + `bootstrap`, lalu **migrasi turun**: bila tabelnya sudah dirilis, migrasi hasil `db:generate` ditulis ulang — `DROP TABLE IF EXISTS` anak→induk dari snapshot drizzle (aman-FK di MySQL; drizzle-kit menulisnya alfabetis) + pembersihan baris core (`modules`, `configurations` `<ns>.*` dan route/tema baku yang menunjuk modul, `group_permissions`, `scheduler_*`, `queue_jobs`, `notifications`, `users.theme`, bump `cache_versions`); bila belum dirilis (migrasi masih untracked) berkas migrasi dikembalikan ke HEAD. Perencana murni di `@core/module-kit` (`remove.ts`, unit test), tidak menyentuh database (terapkan lewat `db:migrate` setelah backup dan setelah image baru ter-deploy). `ci:modgen-guard` dan `ci:cross-repo` kini mencabut lewat perintah ini; halaman Modul menampilkan perintahnya (`module.manage`). Yang dibiarkan: `audit_log`, baris/objek `files`, `app.allowed_themes`, tema kustom ([`MODULES.md`](./MODULES.md) §5)
13. **Registrasi lewat tautan undangan** (A-13, P1; diminta pemilik 2026-09-09) — **selesai**: tabel `invitations` (migrasi 0020; global dengan `client_id` eksplisit karena kode dicari tanpa tenant), `POST/GET/DELETE /v1/invitations` (izin `user.create`, tenant aktif), `GET /v1/auth/join/:code` + `POST /v1/auth/join` (mengabaikan `SIGNUP_ENABLED`, email dianggap terverifikasi, bergabung ke tenant pengundang, sesi langsung dibuka, rate limit `join:ip:`), `security.invitation_hours` (baku 72), email `invite` (+masa berlaku) dan `invite-existing` (alamat sudah terdaftar → ditambahkan ke tenant + info masuk), halaman `/join/<kode>` → `/auth/join/<kode>` tanpa JS, bagian **Undang lewat email** di halaman Pengguna (tautan ditampilkan sekali, daftar menunggu, cabut). Tes integrasi `invitations.test.ts`
14. **Pemantauan outbox email** (J-2, P1; diminta pemilik 2026-09-11) — **selesai**: halaman `/outbox` di grup **Pemantauan** (izin `mail.read`, aksi `mail.manage`) menampilkan seluruh isi tabel `outbox_email` **terbaru di atas** — keping status dengan hitungan dari seluruh tabel, filter status/template/rentang tanggal (`?from`/`?to` per hari kalender, `to` mencakup harinya penuh), pencarian bebas atas alamat penerima, nama penerima, dan subjek, kolom yang bisa diurutkan, ukuran halaman, "Kirim sekarang" (satu putaran worker) dan "Ulangi" per baris gagal. Dua lapis (L-20 di atas L-22): **dasarnya** tautan dan form GET biasa sehingga seluruh kontrol bekerja tanpa JavaScript, **peningkatannya** membuat kontrol yang sama menjawab lewat fetch — bilah filter diterapkan sambil mengetik (debounce 300 ms, `goto` dengan `keepFocus`/`noScroll`, satu entri riwayat per jeda ketik), keping/urutan/paginasi jadi navigasi sisi klien, sedangkan **Ulangi** dan **Kirim sekarang** memakai `use:enhance`: hasilnya jadi toast lalu `invalidateAll()` membaca ulang baris di tempat, tanpa URL berubah jadi `?saved=`/`?delivered=` (jalur tanpa JS tetap memakai notice itu). Filter selalu dikerjakan API, bukan browser. `GET /v1/outbox` kini menerima `?status`, `?template`, `?from`/`?to`, `?sort`/`?order` dan memakai `?q` untuk **pencarian** (sebelumnya `?q` berarti filter status, tanpa pemakai); `GET /v1/outbox/stats` ikut mengembalikan `total` dan daftar template yang dipakai. Dibuktikan `apps/api/test/integration/outbox.test.ts` (API) dan `apps/web/e2e/outbox.e2e.ts` (lapis fetch di peramban sungguhan: penanda di `window` bertahan, jadi tidak ada muat ulang halaman)
15. **Region `aside` bisa dipakai halaman + contohnya** (§4.8, L-19; diminta pemilik 2026-09-11) — **selesai**: keempat layout dasbor sudah punya region `aside` sejak M2 tapi tidak ada satu pun jalan bagi halaman untuk mengisinya, jadi region itu mati. Sekarang halaman **menyebut namanya** (`export const _aside = '<id>'` di `+page.server.ts`/`+page.ts`) — shell dirender lebih dulu sehingga halaman tidak bisa menyerahkan snippet. `bun run layout:variants` mengumpulkannya jadi `pageAsides` (route id → aside id), `(app)/+layout.server.ts` menyelesaikannya, `(app)/+layout.ts` meng-code-split komponennya dari `apps/web/src/lib/asides/registry.ts`, dan `(app)/+layout.svelte` meneruskannya **hanya** bila ada — jadi layout tetap satu kolom untuk halaman yang tidak memintanya. Komponen aside tidak menerima props; ia membaca data `load` halamannya lewat `page.data`, sehingga satu halaman memiliki konten utama dan kolom sampingnya sekaligus. Karena diselesaikan di server, kolom sampingnya ada di HTML pertama dan bekerja tanpa JavaScript. Contohnya halaman baru **`/examples/aside`** (L-19). Dijaga proof M2 #5 dua arah: halaman yang tidak menyebut aside tidak dapat kolom kedua, yang menyebut dapat.
16. **Sidebar bisa diciutkan, tersimpan per pengguna** (F-8, P1; diminta pemilik 2026-09-11) — **selesai**: keadaannya diputuskan di server seperti tema dan bahasa — profil pengguna (kolom `users.sidebar_collapsed`, migrasi 0023) → cookie `crk_sidebar` → terbentang — lalu ditulis sebagai `data-sidebar="expanded|collapsed"` di `<html>` sebelum byte pertama (`apps/web/src/lib/server/sidebar.ts` + `hooks.server.ts`), jadi rail sempit sudah benar di HTML pertama tanpa kedipan. Tombolnya `<SidebarToggle>` di `@core/ui`: **dasarnya** form POST ke `/sidebar` yang menulis cookie + profil lalu kembali ke halaman semula (jalan tanpa JavaScript, L-22), **peningkatannya** `use:enhance` yang membalik atribut seketika dan mengirim POST yang sama di latar — tanpa muat ulang. Layout-lah yang memiliki rail-nya: `sidebar-classic` menggambar tombol itu di kepala rail dan menata sendiri keadaan ciutnya (rail 3,5rem, label di-*clip* sr-only sehingga nama tautan tetap ada untuk pembaca layar dan axe), sedangkan `topnav-compact`/`centered-narrow` tidak menggambarnya sama sekali. Karena pilihannya milik pengguna (D-4), browser kedua yang belum pernah menyentuh tombolnya tetap membuka dasbor dengan rail yang sama — dibuktikan delapan cek F-8 di `scripts/m2-gate-proof.ts`, unit test `apps/web/src/lib/server/sidebar.test.ts`, dan profil di `apps/api/test/integration/admin.test.ts` ([`THEMES.md` §4](./THEMES.md)). **Dilengkapi 2026-09-11 setelah dicoba pemilik:** region nav menerima `rail: true` sehingga shell tahu bedanya rail dan menu vertikal biasa — setiap butir rail membawa **tooltip** namanya (label-nya sedang di-clip), dan tidak ada grup yang dirender terbuka saat ciut; **mengetuk ikon grup kini melebarkan sidebar** (aturan ciut mati saat `#sidebar-rail:has(details[open])`, jadi jalan tanpa JavaScript) dan `use:railExpand` membuat pilihan itu bertahan lewat tombol toggle yang sama. `dummy.two-column` (tema `dummy.ocean`) ikut mendapat rail yang bisa diciutkan — bukti bahwa layout **modul** melakukannya dengan dua langkah yang sama tanpa menyentuh core
17. **Generator tema** (P-11, sebagian; diminta pemilik 2026-09-11) — **selesai**: `bun themegen <id> [--from base] [--module Nama] [--name …] [--icons …] [--layout-dashboard|public|auth …] [--dry-run|--force|--no-register]` menurunkan tema baru dari tema yang sudah lolos kontrak — salinan palet dengan **seluruh** selektor `[data-app-theme="…"]` ditulis ulang (terang dan gelap) dan manifest baru tanpa `assets`/`preview` yang mengarang berkas — lalu **mendaftarkannya**, bagian yang tidak bisa dilakukan `cp -r`: import manifest di `packages/ui-theme/src/registry.ts` (disisipkan urut path agar `lint` tetap hijau) dan import tokens di `apps/web/src/app.css`; tanpa keduanya tema tidak pernah muncul di runtime dan tokennya tidak ikut ter-bundle. `--module <Nama>` menulis ke `modules/<Nama>/themes/<id>` sebagai `<ns>.<id>` dan menjalankan `modules:sync` — nol berkas core berubah (titik perluasan 14). Set ikon/layout yang tidak terdaftar ditolak sebelum ada berkas ditulis (L-5, L-8), dan langkah terakhirnya `theme:validate` sehingga hasilnya lolos gate yang sama dengan tema tulis tangan (L-21). Logika murninya di `scripts/themegen/plan.ts` dengan 15 unit test (`plan.test.ts`) ([`THEMES.md` §5](./THEMES.md)). **Sisa P-11 yang tidak dikerjakan:** generator seed (generator migrasi sudah ada sejak M0 sebagai `bun db:generate`)
18. **Varian landing kedua di modul Example** (R-9, P1; diminta pemilik 2026-09-11) — **selesai**: `/catalog` — susunan publik **kedua** dari modul yang sama di atas tabel yang sama (titik perluasan 13), gaya katalog bukan gaya toko: masthead tipis (tanpa hero/mosaik/paket harga), bilah filter lengket, daftar padat satu baris per produk, JSON-LD `ItemList` (bukan `Organization`), dan form kontak yang dipangkas jadi satu strip (`source: '/catalog'`). Pencarian/urutan dikerjakan **API** (`?q` atas nama+ringkasan, `?sort=name|price`, `?order`, `?featured` di `GET /v1/m/example/products`) supaya jawaban tanpa JavaScript sama persis: **dasarnya** form GET + tautan urut biasa, **peningkatannya** ketikan menerapkan filter setelah jeda 300 ms lewat `goto` (`keepFocus`/`noScroll`, satu entri riwayat per jeda) — pola yang sama dengan `/outbox`. Karena keduanya route publik biasa, `app.landing_route` bisa diarahkan ke salah satunya dan `/` berganti bentuk tanpa deploy (F-5, F-7) — itulah inti R-9. Dibuktikan tujuh cek R-9 di `scripts/m4-gate-proof.ts` (termasuk `/` yang dialihkan ke katalog lalu dikembalikan) dan `apps/api/test/integration/example.test.ts`

---

## 9. Cara membaca kemajuan

Jangan mengukur dengan persentase task. Ukur dengan **berapa gate keluar yang sudah hijau** dan **berapa penjaga CI yang sudah menyala**. Keduanya biner, tidak bisa ditawar, dan tidak bisa "90% selesai".

Kalau sebuah milestone lewat dari estimasi lebih dari 50%, hentikan dan periksa: biasanya penyebabnya bukan kecepatan menulis kode, melainkan sebuah kontrak yang belum benar dan sedang ditambal berulang kali. Itu sinyal untuk kembali ke §4.5 atau §4.8, bukan untuk menambah jam kerja.
