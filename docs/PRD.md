# PRD — AI Dashboard Boilerplate

| | |
|---|---|
| **Produk** | Boilerplate Dashboard Admin dengan fitur AI, siap pakai sebagai template proyek |
| **Versi dokumen** | 2.0 |
| **Tanggal** | 2026-09-06 |
| **Status** | Draft untuk review |
| **Target stack** | SvelteKit + shadcn-svelte + Drizzle ORM + Elysia (Bun); MySQL default, PostgreSQL & lainnya opsional |
| **Prioritas** | API-first · SSR · Modern UI · Theming · AI |
| **Deployment** | **Self-hosted — lokal / VPS.** Bukan serverless, bukan edge |
| **Model kerja** | **Greenfield.** Dibangun dari nol di repositori baru; tidak ada basis kode terdahulu dan tidak ada kewajiban kompatibilitas apa pun |
| **Dokumen terkait** | [`THEMES.md`](./THEMES.md) — spesifikasi & token empat tema bawaan (§4.8, FR-L) · [`ROADMAP.md`](./ROADMAP.md) — urutan pengerjaan, gate keluar, penjaga CI · [`MODULES.md`](./MODULES.md) — panduan membangun modul (G-13), kontrak yang berlaku saat ini, dengan dua tutorialnya: [`Build-Module-for-Boilerplate.md`](./Build-Module-for-Boilerplate.md) dan [`Build-Module-for-Your-Apps.md`](./Build-Module-for-Your-Apps.md) |

---

## 1. Latar Belakang & Tujuan

### 1.1 Masalah yang dipecahkan

Setiap proyek dashboard baru mengulang pekerjaan yang sama: autentikasi, sesi, otorisasi, manajemen user, konfigurasi runtime, tema, terjemahan, tabel data, form, dan — sekarang — integrasi AI. Pekerjaan ini memakan minggu-minggu pertama setiap proyek, dikerjakan ulang dengan kualitas yang berbeda-beda, dan jarang sempat dirapikan setelah fitur bisnis mulai masuk.

Boilerplate ini menyelesaikan semua itu sekali, dengan standar yang ditetapkan di depan, sehingga proyek baru dimulai dari fitur bisnis — bukan dari nol.

### 1.2 Tujuan produk

1. **API-first** — kontrak API jadi sumber kebenaran, bukan turunan. Type-safe dari server sampai klien, dan bisa dikonsumsi klien non-web sejak hari pertama.
2. **SSR** — halaman terender di server: first paint cepat, SEO untuk halaman publik, dan alur inti tetap berfungsi tanpa JavaScript.
3. **Modular** — developer membangun fitur sebagai modul, **tanpa menyentuh satu baris pun kode core**, dan modul itu boleh hidup di repositori lain.
4. **Database-agnostic** — MySQL sebagai default, PostgreSQL dan lainnya sebagai opsi.
5. **Stateless** — bisa dijalankan multi-instance di belakang load balancer sejak hari pertama.
6. **UI modern + multi-tema** — shadcn-svelte, beberapa tema yang bisa dipilih sistem maupun user, dan brand yang bisa diganti tanpa fork komponen.
7. **AI sebagai warga kelas satu** — streaming, multi-provider, MCP, dengan observability biaya/token — dan bisa dimatikan sepenuhnya bila tidak dibutuhkan.
8. **Mudah di-self-host** — satu perintah untuk menjalankan seluruh stack di VPS sederhana, tanpa ketergantungan pada layanan berbayar milik vendor.

### 1.3 Pantangan desain

Delapan hal berikut adalah kegagalan struktural yang lazim pada boilerplate dashboard. Semuanya ditutup **secara desain**, bukan lewat kedisiplinan penulis kode. Kolom terakhir menunjuk kebutuhan yang menutupnya.

| # | Pantangan | Kenapa fatal | Ditutup oleh |
|---|---|---|---|
| D1 | State bersama disimpan di memori proses (token CSRF, cache konfigurasi, store rate-limit, cache sesi) | Aplikasi tidak bisa scale horizontal; muncul bug yang hanya terjadi saat instance > 1 | A-3, E-5, §7 Skalabilitas |
| D2 | Rahasia server memakai prefix variabel yang ter-inline ke bundle browser | Kebocoran kredensial yang tidak terlihat sampai terlambat | P-3, kriteria terima #6 |
| D3 | Klien database diinstansiasi di banyak tempat | Pool koneksi berlipat, kehabisan koneksi pada beban sedang | P-6 |
| D4 | SPA murni tanpa SSR | SEO nol, first paint menunggu bundle + fetch berantai | §4.1, FR-L |
| D5 | Kontrak API dijamin komentar dan di-generate saat build | Dokumen selalu basi; klien non-web tidak bisa dipercaya | FR-N |
| D6 | CSRF dimatikan pada endpoint tertentu "karena merepotkan" | Celah keamanan permanen | A-10 |
| D7 | Skema terkunci pada satu dialect database (tipe & enum native) | Template tidak bisa dipakai klien yang standarnya berbeda | §4.3 |
| D8 | Registrasi modul asimetris — backend otomatis, frontend manual | Kontrak modul membingungkan; janji modularitas bocor | G-2, G-6 |

### 1.4 Non-tujuan

- Bukan produk SaaS jadi. Ini **template** — yang dioptimalkan adalah kecepatan memulai proyek baru, bukan fitur bisnis spesifik.
- Bukan platform serverless/edge. Target deployment adalah mesin yang kita kuasai penuh.
- Bukan mobile app. Responsive web saja (API-first membuka jalan untuk mobile nanti).
- Bukan CMS atau page builder. Landing page yang disediakan adalah **contoh yang dimodifikasi developer**, bukan editor visual untuk end user.

---

## 2. Pengguna & Skenario

| Persona | Kebutuhan | Skenario utama |
|---|---|---|
| **Developer pemakai template** (persona utama) | Mulai proyek dashboard baru dalam hitungan menit, bukan minggu | `bun create` → isi `.env` → `bun db:migrate` → `bun db:seed` → `bun dev` → dashboard jalan lengkap dengan auth, RBAC, tema, dan AI |
| **Developer modul** | Menambah fitur bisnis tanpa menyentuh core, dari repositorinya sendiri | `bun modgen` → dapat CRUD lengkap (API + halaman + tabel DB + menu + izin); atau `bun modules:add <git-url>` untuk memasang modul milik tim lain |
| **Admin sistem (end user)** | Kelola user, group, izin, tenant, tema, dan konfigurasi dari UI | Login → tambah user → masukkan ke group → atur izin → tetapkan tema baku sistem → aktifkan fitur AI dari halaman konfigurasi |
| **End user** | Pakai dashboard, pilih tema & bahasa sendiri, dan asisten AI | Login → lihat dashboard → pilih tema favorit → chat dengan AI (streaming, riwayat tersimpan) |
| **Pengunjung anonim** | Melihat halaman publik (landing / company profile / katalog) | Buka `/` → landing page ter-SSR lengkap, terindeks mesin pencari, tanpa perlu login |
| **Integrator / klien API** | Konsumsi API dari layanan lain, atau hubungkan AI agent | Baca OpenAPI di `/docs` → pakai token → panggil endpoint; atau sambungkan MCP client |

---

## 3. Prinsip Produk

1. **Kontrak dulu, implementasi kemudian.** Skema request/response didefinisikan sekali di server dan otomatis jadi: validasi runtime, tipe TypeScript, dokumen OpenAPI, dan klien typed. Tidak ada dokumentasi yang ditulis manual.
2. **Server-first rendering, klien untuk interaktivitas.** Data yang bisa diambil di server diambil di server. Klien hanya untuk yang benar-benar interaktif.
3. **Stateless secara default.** Tidak ada state bersama di memori proses. Jika butuh state, ke database atau Redis/Valkey.
4. **Aman by default, longgar secara eksplisit.** Setiap endpoint terproteksi kecuali ditandai publik — bukan sebaliknya.
5. **Konfigurasi berjenjang.** `.env` untuk hal yang menentukan cara proses berjalan; database untuk hal yang bisa diubah admin saat runtime. Batasnya tertulis (§4.7, E-6), bukan kebiasaan.
6. **Core tertutup untuk modifikasi, terbuka untuk perluasan.** Ini janji utama produk, bukan fitur tambahan. Developer harus bisa membangun modul lengkap — tabel, API, halaman, menu, izin, konfigurasi, tema, tool AI — **tanpa menyentuh satu baris pun kode boilerplate**, dan dari repositori yang berbeda. Core tidak boleh tahu nama modul mana pun. Setiap kali sebuah kebutuhan modul memaksa perubahan di core, itu **cacat pada kontrak modul**, dan yang diperbaiki adalah kontraknya — bukan ditambal di core.
7. **Tema adalah paket presentasi, bukan palet.** Satu tema menetapkan warna, tipografi, set ikon, aset merek, **dan layout**. Semuanya lewat kontrak: token semantik untuk warna, nama ikon semantik untuk ikon, dan region bernama untuk layout. Komponen dan halaman tidak boleh tahu tema mana yang sedang aktif — kalau sebuah tema menuntut perubahan pada halaman, itu cacat kontrak tema (§4.8).
8. **Setiap fitur besar punya sakelar.** AI dan setiap modul bisa dimatikan. Yang tidak dipakai tidak boleh membebani — tidak di bundle, tidak di menu, tidak di skema.

---

## 4. Arsitektur Target

### 4.1 Topologi

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
└────────────┬────────────────────────────────────────────────┘
             │ HTML (SSR) + hydration + fetch
┌────────────▼────────────────────────────────────────────────┐
│  apps/web  —  SvelteKit (Bun)                                │
│  · SSR + progressive enhancement (form actions)              │
│  · server-side load → panggil API via typed client           │
│  · shadcn-svelte + Tailwind + token tema                     │
└────────────┬────────────────────────────────────────────────┘
             │ HTTP (internal) / Eden Treaty (typed)
┌────────────▼────────────────────────────────────────────────┐
│  apps/api  —  Elysia (Bun)                                   │
│  · Route + skema TypeBox → OpenAPI otomatis                  │
│  · Auth, RBAC, tenancy, rate limit, AI proxy, MCP            │
└──────┬──────────────────────┬───────────────────────────────┘
       │ Drizzle              │
┌──────▼───────────┐  ┌───────▼────────┐  ┌──────────────────┐
│ MySQL (baku) /   │  │ Redis / Valkey │  │ Provider AI      │
│ Postgres / dll   │  │ — OPSIONAL —   │  │ (OpenAI-compat)  │
│ satu database    │  │ sesi, cache,   │  │ + MCP servers    │
│ untuk semua      │  │ rate limit;    │  │                  │
│ tenant           │  │ baku: database │  │                  │
└──────────────────┘  └────────────────┘  └──────────────────┘
```

**Keputusan A — API terpisah dari web, bukan menyatu di SvelteKit.**
`apps/api` adalah proses Elysia berdiri sendiri, bukan route handler di dalam SvelteKit. Alasan: API-first berarti API harus bisa dikonsumsi tanpa SvelteKit sama sekali (mobile, service lain, MCP client). SvelteKit menjadi **konsumen pertama** API-nya sendiri, bukan pemiliknya. Ini otomatis membuktikan API-nya cukup lengkap.

Konsekuensi: ada satu hop jaringan internal antara web dan API. Dalam satu mesin/pod ini diabaikan (< 1 ms). Untuk deployment sederhana keduanya dijalankan satu perintah (`bun dev`), dan di produksi digabung di belakang satu reverse proxy.

**Keputusan B — SvelteKit tidak menyimpan token di browser.**
Sesi disimpan sebagai cookie `httpOnly` `SameSite=Lax`. `load` di server membaca cookie, memanggil API dengan `Authorization` internal, dan mengirim HTML jadi. Ini yang membuat SSR mungkin, sekaligus menghilangkan seluruh kelas bug klien HTTP ber-state global.

**Keputusan C — Modul dirakit saat build, bukan ditemukan saat runtime.**
SvelteKit memakai filesystem router yang diselesaikan saat build, jadi penemuan modul secara dinamis di runtime tidak mungkin dilakukan di sisi frontend. Gantinya: satu langkah `bun modules:sync` (juga jalan otomatis di `predev`/`prebuild`) yang membaca daftar sumber modul dan meng-generate berkas registry — route web, route publik, registrasi route API, skema Drizzle, entri menu, tema, dan seed izin. Untuk sisi API, registri ini tetap bisa dibaca dinamis saat boot.

### 4.2 Struktur repositori

```
.
├── apps/
│   ├── web/                    # SvelteKit
│   │   └── src/
│   │       ├── routes/         # (app)/ (auth)/ (public)/
│   │       ├── lib/
│   │       │   ├── components/ui/      # shadcn-svelte
│   │       │   ├── components/data/    # DataTable, FormBuilder, dsb.
│   │       │   ├── api/                # Eden Treaty client (typed)
│   │       │   └── i18n/
│   │       └── generated/      # registry modul (hasil modules:sync)
│   └── api/                    # Elysia
│       └── src/
│           ├── domains/        # auth, users, groups, clients, config, ...
│           ├── plugins/        # auth, rbac, tenant, ratelimit, logging
│           └── generated/      # registry modul
├── packages/
│   ├── db/                     # Drizzle: deskriptor + skema per dialect + migrasi
│   ├── contracts/              # skema TypeBox bersama + tipe
│   ├── config/                 # loader & validator env
│   ├── module-kit/             # tipe + helper kontrak modul (dipakai modul eksternal)
│   └── ui-theme/               # kontrak tema: token, set ikon, layout, aset
│       ├── themes/             #   tema bawaan (4+)
│       ├── layouts/            #   layout bawaan (dashboard / public / auth)
│       └── icons/              #   nama ikon semantik + set ikon bawaan
├── modules/                    # modul terpasang (folder lokal / git submodule)
│   ├── AI/                     # modul bawaan: chat, riwayat, log, tool
│   └── Example/                # modul bawaan: CRUD referensi + landing page komersil
├── modules.json                # daftar sumber modul (lokal / git / paket)
├── docs/
└── scripts/                    # generator: modul, seed, migrasi, dsb.
```

### 4.3 Isolasi tenant & strategi database (kritis)

**Keputusan N — isolasi tenant per kolom, dalam satu database.**

Seluruh tenant berbagi satu database dan satu set tabel; pemisahnya adalah kolom `client_id`. Tidak ada database-per-tenant, schema-per-tenant, maupun koneksi-per-tenant. Konsekuensinya ditulis di depan supaya tidak jadi kejutan:

- **Yang jadi lebih sederhana:** satu pool koneksi, satu jalur migrasi, satu backup, dan biaya menambah tenant mendekati nol — cocok untuk template yang harus ringan di VPS kecil.
- **Yang jadi tanggung jawab kode:** kebocoran lintas-tenant tidak lagi dicegah oleh batas fisik database, jadi **B-3 (penjaga tenant di lapisan data) naik jadi pengaman utama, bukan kenyamanan.** Query yang lupa memfilter `client_id` adalah insiden keamanan, dan itulah kenapa filternya disuntikkan repository, bukan diserahkan ke masing-masing handler.
- **Yang jadi batasnya:** tenant dengan kebutuhan isolasi fisik (regulasi, residensi data) atau volume sangat besar tidak dilayani bentuk ini. Jalur keluarnya bukan menambah mode di template, melainkan menjalankan instalasi terpisah per tenant seperti itu — yang justru murah karena seluruh state ada di satu database.
- **Indeks selalu diawali `client_id`** untuk tabel ber-tenant, agar query tetap selektif saat jumlah tenant bertambah.

**Dukungan multi-dialect.**

Ini risiko teknis terbesar dari rencana ini dan harus diputuskan di awal.

**Kendalanya:** Drizzle **tidak** punya skema lintas-dialect. `drizzle-orm/mysql-core`, `pg-core`, dan `sqlite-core` adalah API berbeda dengan tipe kolom berbeda. Satu berkas skema tidak bisa melayani MySQL dan PostgreSQL sekaligus.

**Keputusan:** definisikan skema sekali dalam bentuk deskriptor netral di `packages/db/schema/*.def.ts`, lalu **generate** skema Drizzle per dialect (`schema.mysql.ts`, `schema.pg.ts`) lewat `bun db:codegen`. Kode aplikasi hanya mengimpor `packages/db` yang mengekspor skema sesuai `DB_DIALECT`. Query ditulis dengan Drizzle query builder (portabel); SQL mentah dilarang di kode domain. Modul memakai deskriptor yang sama, sehingga modul pihak ketiga otomatis ikut portabel.

**Aturan portabilitas tipe** (wajib dipatuhi deskriptor):

| Konsep | MySQL / MariaDB | PostgreSQL | Catatan |
|---|---|---|---|
| Primary key | `char(36) CHARACTER SET ascii COLLATE ascii_bin` | `uuid` | **UUIDv7 (RFC 9562) di-generate aplikasi**, bukan DB — lihat §4.3.1 |
| Timestamp | `datetime(3)` | `timestamptz(3)` | **Selalu simpan UTC.** Konversi zona waktu di lapisan presentasi |
| JSON | `json` | `jsonb` | Di MariaDB `json` hanyalah alias `longtext` + `json_valid()`, bukan tipe biner seperti MySQL 8. Karena itu: **jangan pernah query ke dalam JSON** di kode portabel, dan jangan mengindeks path JSON |
| Decimal uang | `decimal(18,4)` | `numeric(18,4)` | Jangan pernah float |
| Boolean | `tinyint(1)` | `boolean` | Drizzle menormalkan |
| Enum | `varchar` + constraint aplikasi | `varchar` + constraint aplikasi | **Jangan pakai enum native** — biaya dan mekanisme migrasinya berbeda jauh antar dialect |
| Text panjang | `text` / `longtext` | `text` | |

**Charset & collation ditulis eksplisit, tidak pernah mewarisi dari server.** MySQL 8 baku ke `utf8mb4_0900_ai_ci`, collation yang **tidak ada di MariaDB**. DDL yang mengandalkan nilai baku server akan gagal dijalankan lintas keduanya, dan — lebih berbahaya karena senyap — urutan `ORDER BY` serta tabrakan unique index bisa berbeda. Aturannya: setiap kolom teks menyatakan `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, dan setiap kolom identifier memakai `ascii`/`ascii_bin`.

**Fitur yang dilarang** karena tidak portabel: `RETURNING` pada MySQL, partial index, `ON CONFLICT` gaya PostgreSQL (pakai abstraksi upsert Drizzle), kolom array, full-text search khusus dialect, **tipe `UUID` native MariaDB** (tidak ada di MySQL), dan **SEQUENCE serta system-versioned table** milik MariaDB.

#### 4.3.1 Identifier: UUIDv7, dan jalan keluarnya kalau berubah

**Keputusan O — semua primary key adalah UUIDv7 sesuai RFC 9562, di-generate aplikasi.**

UUIDv7 dipilih justru karena ia yang paling aman terhadap perubahan di kemudian hari:

- **Ia UUID yang sah.** Version 7 dan variant-nya sesuai RFC 9562 (2024, menggantikan RFC 4122). Artinya ia muat di tipe `uuid` PostgreSQL, tipe `UUID` MariaDB, kolom `char(36)`, dan pustaka UUID mana pun — tanpa perlakuan khusus. ULID dan KSUID tidak punya sifat ini: keduanya 128 bit, tapi bila ditulis ke kolom UUID akan menghasilkan nibble version/variant yang tidak valid.
- **Ia terurut waktu.** 48 bit pertama adalah Unix epoch milidetik, sehingga sisipan baru selalu di ujung kanan indeks — inilah yang membuatnya aman sebagai clustered PK di InnoDB, tidak seperti UUIDv4 yang memecah halaman indeks.
- **Monotonik dalam milidetik yang sama.** Generator memakai metode counter RFC 9562 §6.2 (mengganti sebagian bit acak dengan penghitung), sehingga dua ID yang dibuat pada milidetik yang sama tetap terurut. Ini bukan kemewahan: paginasi cursor (N-5) mengandalkan keterurutan ini.
- **Lebar kolomnya netral terhadap versi.** `char(36)` dan `uuid` menampung UUID versi apa pun — v4, v7, maupun v8 (yang RFC 9562 sediakan untuk skema kustom). Kalau suatu saat strategi ID harus berubah, **skemanya tidak ikut berubah**; yang berubah hanya generatornya, dan data lama tetap sah berdampingan dengan data baru.

Karena itu satu aturan pelaksanaan: **ID di-generate di satu tempat saja** — sebuah fungsi di `packages/db`, dipakai core maupun modul. Tidak ada `DEFAULT (UUID())` di DDL, tidak ada generator lokal di modul. Itu yang membuat poin terakhir di atas benar-benar berarti: mengganti strategi ID berarti menyunting satu fungsi, bukan memburu pemanggilan di seluruh repo.

Penyimpanannya `char(36) ascii_bin`, bukan `binary(16)` yang lebih hemat. Alasannya sadar: 36 byte ascii masih murah, sementara ID yang terbaca langsung di klien SQL sangat menghemat waktu saat menelusuri insiden. `ascii_bin` juga membuat perbandingan ID bebas dari perbedaan collation antara MySQL dan MariaDB.

**Cakupan dukungan — mengikuti dialect yang didukung Drizzle, dengan MySQL sebagai baku.** Yang membedakan tier bukan kemauan, melainkan seberapa jauh kami mengujinya:

| Tier | Dialect | Jaminan |
|---|---|---|
| **1 — baku** | **MySQL 8+** | Dialect baku template; ini yang dipakai `compose.prod.yml`. Seluruh suite test jalan di CI |
| **1 — diuji** | **MariaDB 11+** | Seluruh suite test jalan di CI sebagai job tersendiri. MariaDB **bukan** MySQL yang dinamai lain — perbedaan JSON, collation baku, dan tipe UUID-nya nyata (lihat tabel portabilitas di atas), jadi ia diuji terpisah, bukan diasumsikan ikut lolos |
| **1 — diuji** | PostgreSQL 16+ | Seluruh suite test jalan di CI pada **PostgreSQL 16**, sejajar MySQL — inilah yang membuat klaim portabilitas bisa dipercaya. Versi 14–15 kemungkinan besar jalan (tidak ada fitur khusus 16 yang dipakai) tapi tidak masuk matriks CI, jadi tidak dijamin |
| **2 — best-effort** | SQLite | Untuk dev cepat & test; sebagian fitur operasional (backup terjadwal, concurrency tinggi) tidak setara |
| **3 — terbuka** | Dialect lain yang didukung Drizzle | Deskriptor dan codegen terbuka untuk ditambah pemakai template; tidak ada jaminan CI dari kami |

Pemilihan dialect lewat `DB_DIALECT` + `DATABASE_URL`; menambah dukungan dialect baru berarti menambah satu generator di `packages/db`, bukan menyentuh kode domain.

### 4.4 Deployment: lokal & VPS

Target deployment adalah **satu VPS biasa** (2 vCPU / 4 GB cukup untuk memulai). Ini keputusan yang memengaruhi banyak hal lain, jadi ditulis eksplisit.

**Bentuk baku — satu host, Docker Compose:**

```
                    :80 / :443
┌──────────────────────▼──────────────────────────────────┐
│  Caddy (reverse proxy)                                   │
│  · TLS otomatis (Let's Encrypt)                          │
│  · / → web    · /v1/* → api    · /docs → api             │
└──────┬───────────────────────┬──────────────────────────┘
       │                       │
┌──────▼────────┐      ┌───────▼───────┐
│ web (Bun)     │      │ api (Bun)     │   ← keduanya bisa di-scale
│ SvelteKit SSR │      │ Elysia        │      dengan `--scale api=N`
└───────────────┘      └───────┬───────┘
                               │
             ┌─────────────────┼─────────────────┐
      ┌──────▼──────┐   ┌──────▼───────┐  ┌──────▼──────┐
      │ MySQL       │   │ Valkey       │  │ volume      │
      │             │   │(Redis-compat)│  │ uploads/    │
      └─────────────┘   └──────────────┘  └─────────────┘
```

**Keputusan D — Caddy sebagai reverse proxy default, Nginx sebagai alternatif terdokumentasi.**
Caddy mengurus TLS otomatis tanpa cron certbot — mengurangi satu sumber kegagalan operasional pada deployment kecil. Contoh konfigurasi Nginx tetap disediakan bagi yang sudah punya standar sendiri.

**Keputusan E — satu domain, satu origin.**
Web dan API disajikan dari origin yang sama lewat path (`/` dan `/v1`). Ini menghilangkan seluruh kelas masalah CORS dan cookie lintas-domain. API tetap bisa dipublikasikan di subdomain terpisah bagi yang membutuhkannya — CORS jadi konfigurasi, bukan keharusan. Satu instalasi boleh dijangkau lewat **beberapa domain/subdomain** sekaligus (mis. domain lama dan baru, atau uji lokal); tiap domain tetap satu origin untuk web + API, dan daftarnya dideklarasikan di `APP_ORIGIN` (dipisah koma) sebagai daftar putih pemeriksaan `Origin` (A-10). Origin per request diturunkan dari header proxy (`X-Forwarded-Proto/Host`), bukan dari satu nilai tetap.

**Keputusan F — proses stateless, state di volume/Valkey/DB.**
Container web dan api tidak menyimpan apa pun di disk lokal. Berkas unggahan masuk ke volume yang dipetakan (dengan adapter S3-compatible sebagai opsi). Ini yang membuat `--scale api=3` langsung berfungsi, di satu host maupun beberapa host.

**Keputusan M — Redis/Valkey bersifat opsional; database adalah backing store baku untuk state bersama.**

Menambah satu container hanya demi cache adalah beban yang tidak selalu sepadan untuk deployment kecil. Karena itu Redis **tidak wajib**. Yang tetap wajib adalah D1: **tidak ada state bersama yang disimpan di memori proses**, karena itulah yang mematikan scale horizontal.

Keduanya didamaikan dengan satu abstraksi berisi dua adapter. Setiap jenis state bersama punya penyimpan yang bisa ditukar lewat `CACHE_DRIVER` / `SESSION_DRIVER` / `RATELIMIT_DRIVER`:

| Jenis state | Adapter `database` (baku) | Adapter `redis` (opsional) |
|---|---|---|
| Sesi | Tabel `sessions`, dibersihkan job terjadwal | Kunci ber-TTL, tabel tetap jadi sumber kebenaran untuk daftar sesi user |
| Cache konfigurasi | Tabel `configurations` + kolom versi; proses menyimpan salinan di memori **hanya** selama versi masih sama, dan memeriksa versi lewat satu pembacaan baris yang murah | Kunci ber-TTL + invalidasi eksplisit saat simpan |
| Rate limit | Tabel penghitung ber-window, ditulis atomik | `INCR` + `EXPIRE` |
| Token CSRF | Tanpa penyimpanan bersama — `SameSite` + cek `Origin` + double-submit yang tervalidasi kriptografis (A-10) | sama |

Aturan yang menjaga ini tidak berubah jadi dua kualitas yang berbeda:

1. **Adapter `database` wajib benar di bawah multi-instance** — bukan sekadar "cukup untuk dev". Kriteria terima `--scale api=3` (§8) dijalankan **tanpa Redis**, supaya jalur bakunya yang justru terbukti.
2. **Adapter memori murni hanya boleh dipakai pada dev satu proses**, dan menolak start bila `NODE_ENV=production` — pantangan D1 tidak boleh dilanggar lewat pintu belakang konfigurasi.
3. **Redis adalah percepatan, bukan prasyarat fitur.** Tidak boleh ada fitur yang hanya bekerja bila Redis ada. Yang berbeda hanyalah latensi dan beban database.
4. Dokumentasi menyebut **kapan** Redis mulai layak: rate limit dan cache konfigurasi adalah yang pertama menekan database saat trafik naik. Panduan operasional memberi ambang kasar, bukan sekadar "kalau perlu".

**Mode deployment yang didukung:**

| Mode | Untuk siapa | Bentuk |
|---|---|---|
| **Dev lokal** | Developer | `docker compose up -d` (MySQL + Valkey saja) + `bun dev` di host |
| **Single-VPS** (baku) | Mayoritas pemakai template | `docker compose -f compose.prod.yml up -d` — semuanya di satu mesin |
| **VPS tanpa Docker** | Yang punya kebijakan sendiri | Unit systemd untuk web & api, DB & Valkey dari paket OS |
| **Multi-host** | Skala lanjut | Compose/Swarm/K8s; DB & Valkey terkelola terpisah |

Karena semua mode di atas berjalan di mesin yang kita kuasai, **tidak ada batasan runtime edge** — proses berumur panjang, background worker, koneksi SSE panjang, dan filesystem lokal semuanya boleh dipakai.

### 4.5 Kontrak Modul

Modularitas adalah **janji utama produk**, bukan fitur pelengkap (§3 prinsip 6). Karena itu kontraknya didefinisikan di awal, bukan ditemukan sambil jalan.

**Definisi:** sebuah modul adalah satu folder yang bisa disalin masuk atau dihapus, dan aplikasi tetap benar. Menambah modul **tidak boleh** memerlukan perubahan pada berkas core mana pun — tidak di router, tidak di menu, tidak di skema, tidak di seed, tidak di daftar tema.

```
modules/<Nama>/
├── module.json          # nama, versi, deskripsi, engines, dependensi antar-modul
├── db/
│   ├── tables.ts        # deskriptor tabel (netral dialect) — lihat §4.3
│   └── seed.ts          # data awal, idempoten
├── api/
│   ├── routes.ts        # route Elysia + skema TypeBox (jadi OpenAPI otomatis)
│   └── tools.ts         # tool MCP / AI yang disumbangkan modul (opsional)
├── web/
│   ├── routes/          # halaman dashboard, dipetakan ke /m/<nama>/*
│   ├── public/          # halaman publik/landing (opsional) — titik perluasan 13
│   └── components/
├── themes/              # tema yang disumbangkan modul (opsional) — titik perluasan 14
├── layouts/             # layout shell kustom (opsional) — titik perluasan 15
├── icons/               # set ikon / pemetaan ikon (opsional) — titik perluasan 16
├── permissions.ts       # resource + action yang dimiliki modul
├── menu.ts              # entri menu (dengan syarat izin)
├── config.ts            # section konfigurasi milik modul (opsional)
├── i18n/                # id.json, en.json — digabung ke katalog global
└── hooks.ts             # langganan event core (opsional)
```

**Titik perluasan (extension points) yang dijamin core.** Ini daftar tertutup — kalau sebuah kebutuhan modul tidak terlayani salah satu di bawah, yang ditambah adalah kontraknya, bukan tambalan di core.

| # | Titik perluasan | Yang bisa dilakukan modul |
|---|---|---|
| 1 | **Tabel & migrasi** | Mendefinisikan tabel sendiri; ikut alur migrasi & prefix tabel core |
| 2 | **Route API** | Mendaftarkan endpoint beserta skemanya; otomatis muncul di OpenAPI dan klien typed |
| 3 | **Halaman dashboard** | Menyumbang route SvelteKit di namespace-nya sendiri, memakai layout & tema core |
| 4 | **Menu** | Menambah entri menu/sub-menu, tampil hanya bila izin terpenuhi |
| 5 | **Izin** | Mendaftarkan `resource.action` miliknya ke registry RBAC (C-4) |
| 6 | **Konfigurasi** | Menambah section konfigurasi; form-nya di-generate otomatis (FR-E) |
| 7 | **i18n** | Membawa berkas terjemahan sendiri |
| 8 | **Tool AI / MCP** | Menyumbang tool yang bisa dipanggil asisten AI, tetap tunduk RBAC (I-3) |
| 9 | **Event hook** | Berlangganan event core (`user.created`, `tenant.switched`, dst.) — kontraknya di G-17 |
| 10 | **Komponen UI** | Memakai seluruh komponen core lewat alias `@core/ui` |
| 11 | **Widget dashboard** | Menyumbang kartu/widget ke halaman utama dashboard, terfilter izin (G-19) |
| 12 | **Job terjadwal** | Mendaftarkan pekerjaan berkala ke penjadwal core, yang aman di multi-instance (G-18) |
| 13 | **Halaman publik / landing** | Menyumbang route publik tanpa auth di luar namespace `/m/*` (mis. `/`, `/product/:slug`), lengkap dengan metadata SEO. Bentrokan route ditolak saat `modules:sync` dengan pesan jelas |
| 14 | **Tema** | Menyumbang tema lengkap ke registry — token warna, tipografi, set ikon, aset merek, dan pilihan layout; langsung muncul di pemilih tema admin & user (§4.8, FR-L) |
| 15 | **Layout** | Menyumbang layout shell kustom (dashboard / publik / auth) yang memenuhi kontrak region, dan bisa dipakai tema mana pun — termasuk tema bawaan core |
| 16 | **Set ikon** | Menyumbang pemetaan nama ikon semantik → glyph, sehingga seluruh aplikasi bisa berganti bahasa visual tanpa menyentuh komponen |

**Keputusan G — modul dirakit saat build, tapi kontraknya bersifat data.**
`bun modules:sync` membaca `modules.json` dan `module.json` tiap modul, lalu meng-generate registry (route API, route web, route publik, skema DB, menu, izin, i18n, tool, tema). Menambah modul = daftarkan sumbernya + `bun modules:sync`. Core tetap tidak berubah; yang berubah hanya berkas hasil generate, yang tidak pernah diedit tangan.

**Keputusan H — core membuktikan kontraknya sendiri (dogfooding), lewat dua modul bawaan.**
Kontrak modul hanya bisa dipercaya kalau core sendiri memakainya untuk sesuatu yang besar. Karena itu **dua** fitur dibangun sebagai modul, bukan sebagai bagian core:

- **Modul `AI`** — chat, riwayat, log, tool. Menyentuh titik perluasan 1–12. Kalau AI chat bisa hidup sebagai modul, kontraknya terbukti sanggup menopang fitur berat. Kalau tidak bisa, kontraknya belum selesai — dan itu ketahuan di M5, masih cukup awal untuk diperbaiki.
- **Modul `Example`** — CRUD referensi **plus** landing page komersil publik (§4.6). Menyentuh titik perluasan 13 dan 14 yang tidak disentuh modul AI, sekaligus jadi contoh yang disalin developer saat membuat modul pertamanya.

Keduanya wajib bisa dinonaktifkan tanpa menyisakan route yatim, menu rusak, atau tema hilang.

### 4.6 Modul `Example` & landing page komersil

`Example` bukan sekadar demo CRUD. Ia punya tiga peran:

1. **Referensi kontrak** — satu-satunya tempat yang perlu dilihat developer untuk tahu bentuk setiap titik perluasan. Kodenya ditulis untuk dibaca dan disalin, dengan komentar yang menjelaskan *kenapa*, bukan *apa*.
2. **Isi baku halaman `/`** — instalasi bersih tidak boleh menyajikan halaman kosong atau langsung melempar ke `/login`. Landing page `Example` adalah tujuan baku dari root (§4.7).
3. **Bukti bahwa boilerplate ini sanggup melayani sisi publik**, bukan hanya dashboard di balik login.

**Bentuk landing page-nya adalah situs komersil yang meyakinkan** — setara company profile atau etalase e-commerce sederhana, bukan halaman "Hello World" bergaya template:

- Hero dengan judul, sub-judul, CTA, dan gambar/ilustrasi
- Bagian fitur/layanan (grid kartu)
- Etalase produk/portofolio yang **datanya dari tabel milik modul**, bukan hardcoded — ini yang membuktikan alur SSR → API → DB berjalan penuh di halaman publik
- Halaman detail produk `/product/:slug` dengan metadata SEO per halaman (title, description, Open Graph, JSON-LD)
- Testimoni / logo klien
- Bagian harga sederhana
- Kontak / form inquiry yang menulis ke tabel modul dan mengirim email lewat outbox (FR-J), **berfungsi tanpa JavaScript** lewat form action
- Footer dengan navigasi, pemilih bahasa, dan pemilih tema
- Header yang menampilkan tombol "Dashboard" bila sesi aktif, dan "Masuk" bila tidak

Seluruh teksnya lewat i18n (`id`/`en`) dan seluruh warnanya lewat token tema — jadi landing page ikut berganti saat tema diganti, tanpa perubahan kode. Halaman ini sekaligus jadi tempat uji nyata untuk target SEO dan Lighthouse di §7.

### 4.7 Landing page & resolusi route baku

**Keputusan I — halaman baku ditentukan di konfigurasi database, bukan `.env`.**

Pertanyaan "`.env` atau konfigurasi?" dijawab oleh aturan §3 prinsip 5: `.env` hanya untuk hal yang dibutuhkan **sebelum** database bisa dibaca. Landing page tidak termasuk — ia dibutuhkan saat melayani request, admin wajar mengubahnya tanpa restart, dan nilainya bisa berbeda per tenant. Karena itu:

| Kunci | Tempat | Nilai baku | Keterangan |
|---|---|---|---|
| `app.landing_route` | Database (per tenant, fallback global) | `/m/example` | Halaman yang disajikan untuk pengunjung anonim di `/` |
| `app.home_route` | Database (per tenant, fallback global) | `/dashboard` | Tujuan setelah login berhasil |
| `LANDING_ROUTE` | `.env` | `/m/example` | **Hanya** fallback bootstrap saat database belum terisi atau tidak terjangkau |

**Aturan resolusi** (wajib — ini titik gagal yang mudah terlewat):

1. Nilai konfigurasi divalidasi terhadap registry route hasil `modules:sync` **saat disimpan**. Route yang tidak ada ditolak di UI, bukan menghasilkan 404 belakangan.
2. Bila modul pemilik route baku dinonaktifkan atau dihapus (G-8, G-13), resolusi turun ke fallback aman dan mencatat peringatan. Aplikasi tidak boleh mati atau menampilkan 404 di `/`.
3. Landing page bisa diarahkan ke `/login` bagi pemakai template yang tidak ingin punya sisi publik sama sekali — cukup ubah satu nilai konfigurasi, tanpa mengubah kode.
4. Resolusi terjadi **di server saat SSR**, tanpa redirect di klien, agar tidak ada kedipan dan mesin pencari melihat isi sebenarnya.

### 4.8 Anatomi tema: warna, ikon, dan layout

**Keputusan J — tema adalah paket presentasi, bukan palet warna.**

Dua tema boleh berbeda bukan hanya warnanya, tapi juga bahasa ikonnya dan susunan halamannya. Satu tema menetapkan lima hal:

| Bagian | Isi | Bentuk |
|---|---|---|
| **Token** | warna, radius, bayangan, skala spasi, skala tipografi | berkas CSS custom properties |
| **Tipografi** | keluarga font + bobot, **di-host sendiri** (bukan dari CDN — lihat §7 Keamanan & jejak sumber daya) | token + aset font |
| **Set ikon** | pemetaan nama ikon semantik → glyph | berkas pemetaan + paket ikon |
| **Layout** | id layout untuk shell dashboard, publik, dan auth | rujukan ke registry layout |
| **Aset merek** | logo, favicon, ilustrasi state kosong/404 | berkas aset, bisa ditimpa per tenant |

```jsonc
// packages/ui-theme/themes/corporate/theme.json — berkas nyata, bukan ilustrasi
{
  "id": "corporate",
  "name": { "id": "Korporat", "en": "Corporate" },
  "description": {
    "id": "Formal dan padat. Navigasi atas, bukan sidebar.",
    "en": "Formal and dense. Top navigation instead of a sidebar."
  },
  "tokens": "./tokens.css",              // satu berkas memuat light DAN dark:
                                         //   [data-app-theme='corporate']
                                         //   [data-app-theme='corporate'][data-mode='dark']
                                         // token tipografi (--font-sans, --font-mono)
                                         // ikut di dalamnya — tidak ada berkas terpisah
  "icons": "outline-24",                 // id set ikon terdaftar
  "layouts": {
    "dashboard": {
      "default":  "topnav-compact",      // id layout terdaftar. Inilah tema yang
                                         // membuktikan "tema mencakup layout":
                                         // memilihnya menukar sidebar jadi nav atas
      "wide":     "topnav-compact",      // varian untuk halaman lebar (tabel, papan)
      "focused":  "centered-narrow"      // varian untuk wizard / halaman fokus tunggal
    },
    "public": { "default": "marketing-wide" },
    "auth":   { "default": "split-hero" }
  },
  "assets": { "logo": "./logo.svg", "favicon": "./favicon.svg" },
  "preview": "./preview.png"
}
```

Bandingkan dengan `themes/base/theme.json` yang menjawab `default` dengan `sidebar-classic` dan `auth` dengan `centered-card`: dua tema, dua susunan, nol perubahan di halaman. Manifest keempat tema bawaan sudah final — lihat [`THEMES.md`](./THEMES.md).

**Kontrak ikon — komponen tidak pernah mengimpor glyph langsung.**
Core mendefinisikan daftar **nama ikon semantik** (`icon.save`, `icon.user`, `icon.menu`, `icon.chevron-right`, …); modul mendaftarkan namanya sendiri di namespace `<nama>.*` (G-9). Set ikon adalah pemetaan nama → glyph. Komponen hanya menulis `<Icon name="save" />`. Konsekuensinya ditegakkan, bukan disepakati:

- Lint rule melarang impor glyph langsung di komponen dan halaman.
- `modules:sync` memvalidasi bahwa setiap set ikon menutup seluruh nama terdaftar. Nama yang tidak tertutup jatuh ke set baku dengan peringatan di dev, dan **menggagalkan build di CI** — supaya tema tidak diam-diam kehilangan ikon di halaman yang jarang dibuka.
- Set ikon boleh berupa paket pihak ketiga (Lucide, Tabler, Phosphor) maupun sprite SVG milik sendiri.

**Kontrak layout — halaman tidak tahu layout mana yang aktif.**
Layout adalah komponen Svelte yang mengisi **region bernama** dan tidak melakukan apa-apa selain menyusun:

```ts
// layouts/sidebar-classic/layout.ts
export const layout = {
  id: 'sidebar-classic',
  kind: 'dashboard',                    // dashboard | public | auth
  name: { id: 'Sidebar klasik', en: 'Classic sidebar' },
  regions: ['brand', 'nav', 'header', 'breadcrumb', 'content', 'aside', 'footer'],
}
```

Aturan yang mengikat setiap layout — inti dari janji "developer bisa membuat layout sendiri":

1. **Layout tidak mengambil data.** Semua yang dibutuhkannya (menu terfilter izin, breadcrumb, user, tenant aktif, notifikasi) datang sebagai props dari `load` core. Layout yang perlu data baru harus mendapatkannya lewat konteks yang disediakan core — kalau tidak ada, itu cacat kontrak dan yang ditambah adalah kontraknya.
2. **Layout tidak tahu nama modul mana pun.** Ia menerima daftar menu, bukan menyusunnya.
3. **Region wajib diisi.** `modules:sync` memvalidasi layout terhadap daftar region yang dibutuhkan `kind`-nya; region yang hilang ditolak dengan pesan yang menyebut layout dan region mana.
4. **Setiap layout wajib memenuhi baseline yang sama:** SSR-safe, responsif sampai 360 px, navigasi keyboard penuh, dan lolos kontras WCAG AA pada setiap tema yang memakainya (L-21). Layout kustom tidak boleh jadi celah aksesibilitas.
5. **Halaman ditulis sekali untuk semua layout.** Halaman hanya mengisi region `content`; berpindah layout tidak boleh menuntut perubahan pada halaman mana pun — inilah yang diuji di kriteria terima §8.

**Keputusan K — layout boleh berbeda per halaman, lewat varian, bukan lewat id layout.**

Sebagian halaman memang menuntut susunan lain: tabel lebar lebih enak tanpa sidebar, wizard onboarding lebih baik tanpa distraksi, halaman detail besar butuh kolom samping. Karena itu halaman boleh menentukan layoutnya sendiri — tapi **bukan dengan menyebut id layout**.

Kalau halaman menyematkan `sidebar-classic`, halaman itu berhenti netral terhadap tema: mengganti tema tidak lagi mengganti susunannya, dan tema baru harus menyediakan layout bernama persis itu. Karena itu halaman menyebut **varian semantik** — apa yang dibutuhkannya, bukan apa yang harus dipakai:

```ts
// modules/Report/web/routes/matrix/+page.ts
export const layoutVariant = 'wide'      // 'default' | 'wide' | 'focused' | 'split'
```

Tema-lah yang memetakan varian → layout konkret (lihat `theme.json` di atas). Dua tema bisa menjawab `wide` dengan layout yang sama sekali berbeda, dan halaman tidak perlu tahu.

**Rantai resolusi layout untuk sebuah request:**

1. Penimpaan admin untuk route itu, bila ada (konfigurasi, L-9 — P1)
2. `layoutVariant` yang dideklarasikan halaman
3. Varian `default` dari tema aktif untuk jenis shell tersebut
4. Layout baku core

Aturan pendampingnya: daftar varian adalah **registry terbuka** — modul boleh mendaftarkan varian baru (mis. `kanban`) di namespace-nya. Tema yang tidak memetakan sebuah varian jatuh ke `default` miliknya, dengan peringatan di dev, bukan galat — supaya tema pihak ketiga tidak wajib mengenal setiap varian yang pernah dibuat orang. Menyematkan id layout konkret di halaman tetap mungkin sebagai jalan darurat, tapi ditandai lint sebagai halaman yang tidak lagi netral tema.

**Mekanisme di SvelteKit.** Router SvelteKit berbasis filesystem, jadi layout tidak bisa dipilih runtime lewat struktur folder. Gantinya: satu `+layout.svelte` core yang me-resolve layout aktif dari registry hasil `modules:sync` — memakai rantai di atas, dengan `layoutVariant` halaman dibaca dari `load` — lalu merender komponen layout itu secara dinamis. Setiap layout terdaftar di-code-split; hanya layout yang benar-benar dipakai yang terunduh klien. Berpindah antar halaman yang variannya berbeda **tidak boleh menyebabkan hydration mismatch atau kedipan**: layout untuk halaman tujuan sudah ditentukan di server sebelum HTML dikirim.

**Anggaran bundle.** Banyak tema × banyak layout × banyak set ikon bisa membengkakkan build. Karena itu ada allowlist `themes.enabled` saat build: proyek hanya mengirimkan tema yang benar-benar dipakainya, beserta layout dan set ikon yang dirujuk tema-tema itu. Tema yang tidak masuk daftar tetap ada di repo, tapi tidak ikut ter-build.

**Yang tidak boleh dilakukan tema** (batas ini yang menjaga tema tetap jadi tema, bukan fork): mengganti implementasi komponen, menambah atau mengubah route, mengubah data atau perilaku, dan mem-bypass RBAC untuk menampilkan sesuatu. Tema boleh menetapkan nilai baku varian komponen (mis. radius atau ukuran tombol baku), tidak boleh menulis ulang komponennya.

### 4.9 Modul lintas repositori

Modul harus bisa dikerjakan tim lain, di repositori lain, dengan siklus rilisnya sendiri. Ini bukan fitur lanjutan — ia memengaruhi bentuk `packages/module-kit` dan `modules:sync` sejak M0, jadi diputuskan di depan.

**Keputusan L — sumber modul dideklarasikan di `modules.json`; `git submodule` adalah mekanisme sinkronisasi baku.**

```jsonc
{
  "modules": [
    { "name": "Example", "source": "local",     "path": "modules/Example" },
    { "name": "AI",      "source": "local",     "path": "modules/AI" },
    { "name": "Billing", "source": "submodule", "repo": "git@github.com:tim/mod-billing.git", "ref": "v1.4.2" },
    { "name": "Report",  "source": "package",   "package": "@acme/mod-report", "version": "^2.0.0" }
  ]
}
```

- **`local`** — modul yang hidup di repo ini (bawaan atau milik proyek).
- **`submodule`** — jalur baku untuk modul di repo berbeda. `bun modules:add <git-url>` menambahkan submodule ke `modules/<Nama>` dan menulis entri `modules.json`; `bun modules:sync` menjalankan `git submodule update --init` sesuai `ref` yang terkunci, lalu meng-generate registry. `ref` selalu tag/commit, tidak pernah branch berjalan — versi modul harus bisa direproduksi.
- **`package`** — untuk modul yang dirilis sebagai paket npm privat. Diselesaikan dari `node_modules`, bentuk kontraknya persis sama.

**Konsekuensi yang mengikat desain sejak awal:**

1. **`@core/*` harus paket nyata, bukan alias tsconfig.** Modul di repositori lain tidak bisa memakai alias milik repo ini. `packages/module-kit`, `@core/ui`, dan `@core/db` diterbitkan (registry privat atau tarball) dan dideklarasikan sebagai `peerDependency` modul. Alias yang hanya hidup di `tsconfig.json` akan membuat modul eksternal gagal dibangun sendiri — dan itu baru ketahuan terlambat.
2. **Modul harus bisa dibangun, di-lint, dan dites di repositorinya sendiri**, tanpa meng-clone core. Disediakan `create-module` starter berisi konfigurasi build, tipe kontrak, dan harness test yang menjalankan modul di atas core minimal.
3. **Versi kontrak eksplisit.** `module.json` menyatakan `engines.core` (rentang semver core yang didukung). `modules:sync` menolak modul yang tidak cocok, dengan pesan yang menyebut versi yang dibutuhkan dan yang terpasang — bukan gagal dengan error impor yang membingungkan.
4. **Isolasi namespace ditegakkan, bukan disepakati** (G-9). Dua modul dari penulis berbeda tidak boleh bentrok di tabel, route, izin, kunci i18n, maupun nama tema.
5. **Modul eksternal tidak boleh dimodifikasi di repo pemakai.** Perubahan pada folder submodule terdeteksi dan diperingatkan saat `modules:sync` — kalau perlu diubah, ubah di repo asalnya.

---

## 5. Lingkup Rilis

| Prioritas | Isi |
|---|---|
| **P0 — MVP** | **Kontrak modul + generator modul + modul lintas repositori**, **event bus + penjadwal core** (G-17, G-18), auth & sesi, multi-tenant, RBAC, CRUD user/group/permission/client, konfigurasi runtime, menu dinamis, **sistem tema lengkap (warna + ikon + layout; baku sistem + pilihan user; layout kustom oleh developer)**, multi-bahasa, DataTable + FormBuilder, **modul `Example` + landing page komersil**, **modul `AI`** (chat streaming + riwayat, bisa dimatikan), OpenAPI + typed client, migrasi Drizzle multi-dialect, seed, **email + outbox** (J-1…J-3), **audit log + log AI + kebijakan retensi** (M-2, M-3, H-9), **penyamaran data sensitif di log** (M-7), **volume berkas unggahan & path lewat env** (Q-9), **paket deployment single-VPS** |
| **P1** | MCP server & client (I-1…I-6), notifikasi dalam aplikasi (J-4), multi-provider AI + perhitungan biaya per model (H-10), **endpoint upload berkas + adapter S3** (Q-16), **adapter Redis untuk sesi/cache/rate limit** — inilah yang dimaksud "rate limit terdistribusi" (Keputusan M), UI admin modul (G-14), editor tema dari UI (L-24), metrik Prometheus (M-6), operasi lanjutan — systemd, deploy tanpa downtime, preflight, resource limit (Q-11…Q-14) |
| **P2** | 2FA/TOTP, SSO tambahan (GitHub, X, Microsoft), webhook keluar, ekspor data (CSV/XLSX), impersonasi user oleh admin, **queue pekerjaan ad-hoc** (retry, prioritas, dead-letter — bukan penjadwal berkala yang sudah P0), dashboard analitik penggunaan AI (H-15), registry/marketplace modul |
| **Out of scope** | Billing/subscription, mobile app native, editor visual halaman (page builder), multi-region active-active |

Tabel ini adalah ringkasan; **tag `[P0]`/`[P1]`/`[P2]` pada tiap kebutuhan di §6 adalah yang mengikat.** Kalau keduanya berbeda, tag per-kebutuhan yang menang dan tabel ini yang salah — perbaiki tabelnya di PR yang sama.

---

## 6. Kebutuhan Fungsional

Notasi: **[P0]/[P1]/[P2]** prioritas.

### FR-A · Autentikasi & Sesi

| ID | Kebutuhan |
|---|---|
| A-1 | **[P0]** Registrasi email + password. Password di-hash dengan **Argon2id**. Registrasi bisa dimatikan lewat flag `SIGNUP_ENABLED`. |
| A-2 | **[P0]** Login email + password, mengembalikan sesi. Kegagalan login kena rate limit lebih ketat daripada endpoint biasa (baku 10 percobaan / 15 menit, konfigurabel). |
| A-3 | **[P0]** **Sesi berbasis cookie `httpOnly`**, bukan token di `localStorage`. Cookie: `Secure`, `SameSite=Lax`, `Path=/`. Sesi tersimpan lewat `SESSION_DRIVER`: baku ke tabel `sessions`, opsional ke Redis/Valkey (Keputusan M). Alasan: SSR butuh membaca sesi di server, dan `localStorage` rawan XSS. |
| A-4 | **[P0]** Untuk klien non-browser (mobile, service), sediakan **API token** bearer terpisah dengan masa berlaku dan scope sendiri. Ini yang membuat "API-first" nyata. |
| A-5 | **[P0]** Logout — invalidasi sesi di server, bukan sekadar menghapus cookie. |
| A-6 | **[P0]** Verifikasi email: token + kedaluwarsa, kirim email, endpoint konfirmasi. |
| A-7 | **[P0]** Lupa password: minta reset → validasi token → konfirmasi password baru. Token sekali pakai, punya `expires_at` dan penanda `used`. |
| A-8 | **[P1]** Google OAuth. Opsi auto-create akun saat login pertama, dikendalikan flag. |
| A-9 | **[P1]** Single-session login — satu user hanya boleh punya satu sesi aktif; login baru mematikan yang lama. Dikendalikan flag. |
| A-10 | **[P0]** **Proteksi CSRF berlaku untuk seluruh endpoint yang mengubah state, tanpa pengecualian.** Mekanismenya: `SameSite=Lax` + validasi header `Origin`/`Referer` + token double-submit untuk form. Endpoint publik ditandai eksplisit lewat daftar putih, bukan dengan mematikan middleware (D6). |
| A-11 | **[P2]** 2FA TOTP + recovery codes. |
| A-12 | **[P0]** Rekam `last_seen`, `ip`, dan `device` per sesi. |
| A-13 | **[P1]** Registrasi lewat **tautan undangan** per tenant (`/join/<kode>`): admin dengan `user.create` mengundang alamat email; tautan berlaku `security.invitation_hours` (baku 72 jam) dan **tetap bisa dipakai saat `SIGNUP_ENABLED=false`** (flag itu hanya mengatur pendaftaran mandiri). Email yang sudah terdaftar tidak diundang: akunnya ditambahkan ke tenant dan dikirimi informasi untuk masuk. Undangan bisa dicabut; mengundang ulang alamat yang sama mencabut yang lama. |

### FR-B · Multi-Tenancy

| ID | Kebutuhan |
|---|---|
| B-0 | **[P0]** **Isolasi tenant per kolom, satu database untuk seluruh tenant** (Keputusan N). Tidak ada database, schema, atau koneksi terpisah per tenant. Setiap tabel ber-tenant punya kolom `client_id` yang wajib terindeks bersama kunci pencarian utamanya. |
| B-1 | **[P0]** Tenant = baris di tabel `clients`, mendukung hierarki lewat `parent_id`. |
| B-2 | **[P0]** Tenant aktif ditentukan dari sesi (server-side), bukan hanya dari header yang dikirim klien. Header `X-Client-ID` tetap didukung untuk klien API, tapi **wajib divalidasi terhadap keanggotaan user** (`client_user_maps`) — bukan sekadar dicek keberadaannya. |
| B-3 | **[P0]** **Penjaga tenant di lapisan data, bukan di setiap handler.** Semua query lewat helper repository yang otomatis menyuntikkan filter `client_id`. Query yang sengaja lintas-tenant harus memanggil API eksplisit (`unsafeAcrossTenants()`) yang mudah di-grep saat audit. |
| B-4 | **[P0]** UI switcher tenant untuk user yang punya akses ke lebih dari satu tenant. Ganti tenant = navigasi ulang server-side, bukan sekadar ganti state klien. |
| B-5 | **[P0]** Instalasi single-tenant tetap wajar: satu tenant baku ter-seed, dan switcher disembunyikan bila user hanya punya satu tenant. Multi-tenancy tidak boleh terasa membebani proyek yang tidak memakainya. |
| B-6 | **[P1]** Kuota & saldo per tenant (`balance`, `credit`) — dipakai untuk membatasi pemakaian AI. |

### FR-C · Otorisasi (RBAC)

| ID | Kebutuhan |
|---|---|
| C-1 | **[P0]** Izin berbentuk `resource.action`. Action baku: `read`, `create`, `edit`, `manage` (`manage` mencakup semuanya). |
| C-2 | **[P0]** Wildcard didukung: `*.*`, `user.*`, `*.read`. |
| C-3 | **[P0]** Izin diberikan ke **group**; user mewarisi lewat keanggotaan group; group bersifat per-tenant. |
| C-4 | **[P0]** **Registry resource terpusat.** Setiap modul mendaftarkan resource yang dimilikinya; daftar ini yang mengisi dropdown UI izin dan memvalidasi seed. Nama resource tidak boleh sekadar konvensi yang tak tervalidasi. |
| C-5 | **[P0]** Superadmin ditentukan lewat **flag di database** (`users.is_superadmin`), dengan opsi bootstrap dari env untuk instalasi pertama. Mengubah superadmin tidak boleh butuh restart. |
| C-6 | **[P0]** Penegakan izin di dua lapis: (a) API — wajib, sumber kebenaran; (b) UI — kosmetik, menyembunyikan aksi yang tidak diizinkan. Klien tidak pernah dipercaya. |
| C-7 | **[P0]** Endpoint yang mengembalikan izin efektif user saat ini, dipakai SSR untuk merender menu & tombol tanpa kedipan. |
| C-8 | **[P1]** Halaman panduan izin — menjelaskan semantik `resource.action` dan wildcard kepada admin. |

### FR-D · Manajemen User, Group, Tenant

| ID | Kebutuhan |
|---|---|
| D-1 | **[P0]** CRUD user: list (paginasi, cari, urut, filter), detail, buat, ubah, hapus lunak. |
| D-2 | **[P0]** CRUD group + CRUD izin di dalam group + kelola anggota group. |
| D-3 | **[P0]** CRUD tenant (`clients`), termasuk endpoint "scope" — daftar tenant yang boleh diakses user saat ini. |
| D-4 | **[P0]** Halaman profil sendiri: info dasar, ubah password, avatar, dan preferensi (bahasa, **tema**). |
| D-5 | **[P1]** Indikator status online berdasarkan `last_seen`. |
| D-6 | **[P2]** Impersonasi user oleh pemegang izin `user.impersonate` (superadmin selalu termasuk), dengan penanda peringatan di menu akun dan audit log. Non-superadmin hanya menjangkau anggota tenant aktifnya, dan tidak boleh memerankan user yang memegang izin di luar miliknya (C-5). |

### FR-E · Konfigurasi Runtime

| ID | Kebutuhan |
|---|---|
| E-1 | **[P0]** Konfigurasi tersimpan di database dengan bentuk `section` / `sub` / `key` / `value` / `type` / `title` / `note` / `order` / `public`. |
| E-2 | **[P0]** Konfigurasi bersifat per-tenant dengan fallback ke global (`client_id IS NULL`). Nilai global harus benar-benar terpakai saat tenant belum menimpanya. |
| E-3 | **[P0]** Form konfigurasi **di-generate** dari metadata section + `type` field (`string`, `text`, `number`, `boolean`, `select`, `secret`, `markdown`, `route`, `theme`). Tipe tervalidasi skema, bukan string bebas. |
| E-4 | **[P0]** Field `public` menentukan apakah nilai boleh dibaca klien yang belum login. Field bertipe `secret` **tidak pernah** dikirim ke klien dalam bentuk asli — hanya penanda "sudah diisi". |
| E-5 | **[P0]** Cache konfigurasi lewat `CACHE_DRIVER` (Keputusan M), **bukan `Map` proses yang tak tervalidasi**. Adapter `database` (baku) memakai kolom versi: salinan di memori hanya dipakai selama versi masih cocok. Adapter `redis` memakai TTL + invalidasi eksplisit saat simpan. Menyimpan konfigurasi **selalu** menaikkan versi/menginvalidasi, di adapter mana pun — instance lain wajib melihat perubahan tanpa restart. Menutup D1. |
| E-6 | **[P0]** Batas `.env` vs database ditulis eksplisit dan ditegakkan: `.env` hanya untuk hal yang dibutuhkan **sebelum** database bisa dibaca (koneksi DB, Redis, port, secret sesi, mode, fallback bootstrap). Selebihnya di database (§4.7). |
| E-7 | **[P0]** Demo mode: semua operasi tulis ditolak dengan pesan yang jelas. |
| E-8 | **[P0]** Section konfigurasi bawaan minimal: `app` (nama, logo, `landing_route`, `home_route`, `default_theme`, **`allowed_themes`** — daftar tema yang boleh dipilih user, bahasa baku), `ai`, `mail`, `security`. Modul menambah sectionnya sendiri lewat titik perluasan 6. |
| E-9 | **[P1]** Penimpaan layout per route dari konfigurasi (`app.route_layouts`), divalidasi terhadap registry route & layout saat disimpan (L-9). |

### FR-F · Navigasi, Menu, & Halaman Baku

| ID | Kebutuhan |
|---|---|
| F-1 | **[P0]** Menu sidebar dibangun dari gabungan menu core + menu yang didaftarkan modul, lalu **difilter berdasarkan izin user**. |
| F-2 | **[P0]** Menu di-resolve **saat SSR** dan ikut terkirim di HTML pertama — sidebar tidak boleh berkedip. |
| F-3 | **[P0]** Menu mendukung ikon, badge, grup, dan sub-menu satu tingkat. |
| F-4 | **[P0]** Breadcrumb otomatis dari struktur route. |
| F-5 | **[P0]** **Landing page baku dari konfigurasi** (§4.7): `app.landing_route` menentukan isi `/` untuk pengunjung anonim, `app.home_route` menentukan tujuan setelah login. Keduanya diubah dari UI konfigurasi tanpa restart, dan divalidasi terhadap registry route. |
| F-6 | **[P0]** Fallback aman: bila route baku menunjuk modul yang nonaktif atau hilang, aplikasi tetap menyajikan halaman valid dan mencatat peringatan — bukan 404 di halaman depan. |
| F-7 | **[P0]** Route publik (dari modul, titik perluasan 13) terdaftar di sitemap dan menghormati `robots.txt` yang dapat dikonfigurasi. |
| F-8 | **[P1]** Sidebar bisa diciutkan; state tersimpan per user. |
| F-9 | **[P1]** Command palette (⌘K) untuk lompat antar halaman dan aksi. |

### FR-G · Sistem Modul

| ID | Kebutuhan |
|---|---|
| G-1 | **[P0]** Satu modul = satu folder `modules/<Nama>/` dengan bentuk pada §4.5. |
| G-2 | **[P0]** **Registrasi simetris.** Satu perintah `bun modules:sync` meng-generate registry untuk API *dan* web *dan* route publik *dan* skema DB *dan* menu *dan* tema *dan* seed izin. Perintah ini jalan otomatis sebelum `dev` dan `build`. Menutup D8. |
| G-3 | **[P0]** Modul mengimpor core lewat **paket** (`@core/ui`, `@core/db`, `@core/module-kit`), bukan path relatif. Memindahkan folder modul — atau memindahkannya ke repositori lain — tidak boleh merusak apa pun (§4.9 poin 1). |
| G-4 | **[P0]** Generator modul CLI (`bun modgen`) — hasilkan CRUD lengkap: tabel, migrasi, route API dengan skema, halaman list+form, entri menu, seed izin, berkas i18n. Mode interaktif dan non-interaktif. |
| G-5 | **[P0]** **16 titik perluasan pada §4.5 tersedia seluruhnya**, terdokumentasi, dan masing-masing punya contoh yang jalan. |
| G-6 | **[P0]** **Menambah atau menghapus modul tidak mengubah berkas core mana pun.** Ditegakkan di CI: pipeline menjalankan `modgen`, lalu memeriksa bahwa `git diff` hanya menyentuh `modules/`, `modules.json`, dan direktori hasil generate. Ini mengubah janji modularitas dari niat menjadi sesuatu yang terukur. |
| G-7 | **[P0]** Kegagalan satu modul saat inisialisasi tidak boleh mematikan aplikasi; catat galatnya, tandai modul sebagai gagal di UI admin, lanjutkan. |
| G-8 | **[P0]** Modul bisa diaktifkan/nonaktifkan **per tenant** lewat tabel `modules`. Modul nonaktif: menu hilang, route menolak, tema & route publiknya tidak terdaftar, tabelnya tetap ada. |
| G-9 | **[P0]** Namespace terisolasi dan **divalidasi saat sync**: tabel diawali nama modul, route API di `/v1/m/<nama>/*`, route dashboard di `/m/<nama>/*`, resource izin di `<nama>.*`, kunci i18n di `<nama>.*`, nama tema di `<nama>.*`. Bentrokan antar modul ditolak dengan pesan yang menyebut kedua modul. |
| G-10 | **[P0]** **Modul lintas repositori** (§4.9): `modules.json` mendeklarasikan sumber (`local` / `submodule` / `package`); `bun modules:add <git-url>` memasang submodule dan mengunci `ref`; `bun modules:sync` menyinkronkan lalu meng-generate registry. |
| G-11 | **[P0]** `module.json` menyatakan `engines.core`; ketidakcocokan versi ditolak saat `modules:sync` dengan pesan yang menyebut versi dibutuhkan vs terpasang. Dependensi antar-modul dinyatakan dan diurutkan saat inisialisasi. |
| G-12 | **[P0]** Starter modul standalone (`bun create module`) — repositori modul bisa di-build, di-lint, dan dites sendiri tanpa meng-clone core (§4.9 poin 2). |
| G-13 | **[P0]** Dokumen **"Membangun Modul Pertama Anda"** — panduan berurutan dari nol sampai modul jalan, termasuk cara mengerjakannya di repositori terpisah, plus referensi lengkap kontrak §4.5. Tanpa ini, modularitas hanya klaim. |
| G-14 | **[P1]** UI admin: daftar modul terpasang, sumber & versinya, status aktif/nonaktif per tenant, dan pesan galat bila gagal dimuat. |
| G-15 | **[P1]** Uninstall modul yang bersih: perintah yang menghapus registrasi dan menyediakan migrasi turun untuk tabelnya (dengan konfirmasi eksplisit). |
| G-16 | **[P2]** Registry/marketplace modul sederhana — telusuri dan pasang modul dari katalog. |
| G-17 | **[P0]** **Event bus core** (titik perluasan 9). Core menerbitkan event bernama (`user.created`, `user.deleted`, `tenant.switched`, `config.saved`, `module.enabled`, dst.); modul berlangganan lewat `hooks.ts`. Kegagalan sebuah hook dicatat dan **tidak menggagalkan aksi intinya** (sejalan G-7). Urutan eksekusi deterministik, mengikuti urutan dependensi modul (G-11). Daftar event adalah bagian kontrak: menghapus atau mengubah payload sebuah event adalah perubahan yang merusak dan tunduk `engines.core` (N-6). |
| G-18 | **[P0]** **Penjadwal core** (titik perluasan 12). Core dan modul mendaftarkan pekerjaan berkala. **Wajib benar di multi-instance:** dengan `--scale api=3` sebuah job berjalan **sekali per jadwal, bukan tiga kali** — lock diambil lewat database supaya jalur bakunya tidak menuntut Redis (Keputusan M, D1). Job yang gagal dicatat, di-retry dengan backoff, dan tidak menahan job lain. Pemakai P0-nya sudah ada sejak awal: pembersihan `sessions`, worker outbox (J-2), retensi log AI (M-3), dan backup terjadwal (Q-8) — jadi ini kontrak fondasi, bukan fitur lanjutan. |
| G-19 | **[P0]** **Registry widget dashboard** (titik perluasan 11). Modul menyumbang kartu/widget ke halaman utama dashboard, **terfilter izin dan ter-render saat SSR** dengan aturan yang sama seperti menu (F-1, F-2) — widget yang izinnya tidak terpenuhi tidak ikut terkirim ke klien, bukan disembunyikan CSS. Urutan & penempatan lewat metadata, bukan lewat perubahan halaman core. |

### FR-R · Modul `Example` & Halaman Publik

| ID | Kebutuhan |
|---|---|
| R-1 | **[P0]** Modul `Example` tersedia sebagai modul bawaan yang dibangun **memakai kontrak §4.5 yang sama** dengan modul pihak ketiga — tanpa jalur istimewa dari core. |
| R-2 | **[P0]** `Example` menyediakan **landing page komersil publik** dengan seluruh bagian pada §4.6, dan menjadi isi baku dari `/` pada instalasi bersih. |
| R-3 | **[P0]** Etalase produk/portofolio pada landing page mengambil data dari **tabel milik modul**, ter-SSR, dengan halaman detail `/product/:slug`. |
| R-4 | **[P0]** SEO: metadata per halaman (title, description, canonical, Open Graph, JSON-LD), sitemap, dan `robots.txt`. Halaman publik terindeks tanpa JavaScript. |
| R-5 | **[P0]** Form kontak/inquiry berfungsi **tanpa JavaScript** (form action), menulis ke tabel modul, mengirim email lewat outbox, dan terlindung rate limit + proteksi spam sederhana. |
| R-6 | **[P0]** `Example` juga menyediakan sisi dashboard: CRUD atas datanya sendiri, entri menu, izin `example.*`, section konfigurasi, dan terjemahan `id`/`en`. Ini bagian "referensi kontrak"-nya. |
| R-7 | **[P0]** Seluruh warna landing page lewat token tema, dan seluruh teksnya lewat i18n — mengganti tema atau bahasa tidak menyentuh kode `Example`. |
| R-8 | **[P0]** `Example` bisa dihapus atau dinonaktifkan seluruhnya; aplikasi tetap berfungsi dan `/` jatuh ke fallback (F-6). |
| R-9 | **[P1]** Varian landing page kedua (mis. gaya SaaS vs gaya katalog) sebagai contoh bahwa satu modul bisa menyumbang lebih dari satu susunan halaman publik. |

### FR-H · AI: Chat & Percakapan

| ID | Kebutuhan |
|---|---|
| H-1 | **[P0]** Seluruh fitur AI hidup sebagai **modul `AI`** (Keputusan H) dan bisa dimatikan pada tiga tingkat: dilepas dari `modules.json` (tidak ikut ter-build sama sekali), dinonaktifkan per tenant lewat tabel `modules`, atau dimatikan lewat konfigurasi `ai.enable`. |
| H-2 | **[P0]** Endpoint chat kompatibel-OpenAI (`POST /v1/m/ai/chat/completions`) yang mem-proxy ke provider yang dikonfigurasi. Provider bersifat data (`ai.baseurl`, `ai.key`, `ai.model`), bukan kode. |
| H-3 | **[P0]** **Streaming** wajib jalan end-to-end: provider → API → SvelteKit → UI, token demi token, dengan pembatalan yang benar saat user menutup tab atau menekan stop. |
| H-4 | **[P0]** Bila fitur AI aktif tapi API key belum diisi, permintaan ditolak dengan pesan yang jelas dan dapat ditindaklanjuti — bukan galat generik. |
| H-5 | **[P0]** System prompt bisa dikonfigurasi per tenant, disuntikkan bila belum ada pesan `system` di request. |
| H-6 | **[P0]** Percakapan dipersistensi: `conversations` + `messages`, dengan judul otomatis dari pesan pertama, arsip, dan hapus lunak. |
| H-7 | **[P0]** Riwayat percakapan tampil di sidebar chat, dikelompokkan per waktu, bisa dicari. |
| H-8 | **[P0]** Rendering markdown pada balasan AI dengan sanitasi. Blok kode ber-syntax-highlight dan tombol salin. |
| H-9 | **[P0]** **Setiap panggilan AI dicatat** (endpoint, model, token in/out/total, latensi, status, biaya). **Penulisan log asinkron** — tidak menahan jalur panas request. |
| H-10 | **[P1]** Multi-provider: lebih dari satu profil provider tersimpan, bisa dipilih per percakapan. Perhitungan biaya per model dari tabel harga. |
| H-11 | **[P1]** Lampiran pada pesan (`message_attachments`). |
| H-12 | **[P1]** Threading pesan (`parent_id`) — regenerate & edit-lalu-cabang. |
| H-13 | **[P1]** Floating chat button di seluruh dashboard, dengan konteks halaman aktif. |
| H-14 | **[P2]** Kuota AI per tenant/user memakai `balance`/`credit`; tolak saat habis. |
| H-15 | **[P2]** Dashboard analitik AI: token & biaya per hari/model/user. |

### FR-I · MCP (Model Context Protocol)

| ID | Kebutuhan |
|---|---|
| I-1 | **[P1]** Aplikasi **menyajikan** MCP server memakai **SDK MCP resmi**, bukan implementasi JSON-RPC manual. Alasan: protokolnya berkembang; implementasi manual akan tertinggal. |
| I-2 | **[P1]** Metode yang didukung: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`. |
| I-3 | **[P1]** Modul bisa mendaftarkan tool MCP-nya sendiri. Registry tool memakai registry resource RBAC yang sama, sehingga **pemanggilan tool tetap tunduk pada izin user**. |
| I-4 | **[P1]** Aplikasi juga bisa menjadi **MCP client** — menyambung ke MCP server eksternal (tabel `mcps` + `mcp_tools`, transport stdio/sse/websocket/http/stream). Tool dari server eksternal bisa dipakai dalam percakapan AI. |
| I-5 | **[P1]** UI admin untuk mendaftarkan & menguji koneksi MCP server. |
| I-6 | **[P1]** Endpoint MCP terautentikasi dan tunduk pada tenancy — tidak boleh jadi pintu belakang yang melewati RBAC. **Prasyarat rilis FR-I, bukan pekerjaan terpisah:** MCP tidak boleh dinyatakan selesai (ROADMAP §8 butir 2) sebelum ini dibuktikan test — request tanpa sesi/token ditolak, dan tool hanya melihat data tenant aktif — dengan standar yang sama seperti kriteria §8 #10 untuk CSRF. Bertanda P1 hanya karena ia mengikuti jadwal MCP; sifatnya tidak bisa ditawar. |

### FR-J · Email & Notifikasi

| ID | Kebutuhan |
|---|---|
| J-1 | **[P0]** Layanan email SMTP untuk: verifikasi email, reset password, undangan user, dan form kontak landing page (R-5). |
| J-2 | **[P0]** Pola **outbox** — email ditulis ke tabel `outbox_email` lalu dikirim worker, dengan retry dan status. Benar-benar asinkron, tidak menahan request. Isinya dipantau dari halaman `/outbox` (grup Pemantauan, izin `mail.read`): terbaru di atas, dengan filter status/template/rentang tanggal, pencarian penerima & subjek, dan aksi ulangi / kirim sekarang untuk pemegang `mail.manage`. |
| J-3 | **[P0]** Template email mendukung i18n dan mengikuti brand (logo, warna dari token tema aktif). |
| J-4 | **[P1]** Notifikasi dalam aplikasi (bell di header), lengkap dengan backend-nya. |
| J-5 | **[P2]** Webhook keluar untuk event penting. |

### FR-K · Internasionalisasi

| ID | Kebutuhan |
|---|---|
| K-1 | **[P0]** Minimal `id` dan `en`, mudah ditambah lewat berkas JSON + daftar bahasa. Tidak ada batas jumlah bahasa. |
| K-2 | **[P0]** Bahasa ditentukan **di server** (preferensi user → cookie → header `Accept-Language` → baku dari konfigurasi) dan dipakai saat SSR. Render pertama tidak boleh selalu bahasa baku. |
| K-3 | **[P0]** Bahasa baku sistem diatur dari konfigurasi database (per tenant, fallback global); user bisa menimpanya lewat preferensi profil (D-4). |
| K-4 | **[P0]** Terjemahan yang hilang: tampilkan key dan catat peringatan di dev; jangan tampilkan string kosong. |
| K-5 | **[P0]** Kunci terjemahan bertipe (type-safe) — key salah ketik ketahuan saat build, bukan saat runtime. |
| K-6 | **[P0]** Modul membawa berkas terjemahannya sendiri, digabung saat `modules:sync`, dengan namespace `<nama>.*` (G-9). |
| K-7 | **[P0]** Halaman publik/landing ikut ber-i18n, dengan pemilih bahasa yang bekerja tanpa login dan tanpa JavaScript. |
| K-8 | **[P1]** Format tanggal, angka, dan mata uang mengikuti locale + zona waktu tenant. |
| K-9 | **[P2]** Dukungan RTL. |

### FR-L · UI, Tema, & Komponen

| ID | Kebutuhan |
|---|---|
| L-1 | **[P0]** Basis komponen **shadcn-svelte** (disalin ke repo, bukan dependensi terkunci) di atas Tailwind. |
| L-2 | **[P0]** Seluruh warna, radius, dan font lewat **token semantik CSS** (`--background`, `--foreground`, `--primary`, `--muted`, `--destructive`, dst.). Tidak ada warna hardcoded di komponen mana pun — ini prasyarat semua kebutuhan tema di bawah. |
| L-3 | **[P0]** **Multi-tema, dan tema mencakup lebih dari warna.** Satu tema adalah paket berisi token warna & tipografi, set ikon, aset merek, dan pilihan layout (§4.8). Terdaftar di registry dengan `id`, nama terterjemahkan, dan gambar pratinjau. Boilerplate hadir dengan **minimal 4 tema bawaan** yang berbeda karakter — dan minimal **dua di antaranya memakai layout yang berbeda**, bukan sekadar palet berbeda. |
| L-4 | **[P0]** Setiap tema punya varian **light dan dark**; mode `light / dark / system` berlaku ortogonal terhadap pilihan tema. |
| L-5 | **[P0]** **Set ikon sebagai bagian tema.** Komponen memakai nama ikon semantik (`<Icon name="save" />`), tidak pernah mengimpor glyph langsung — ditegakkan lint rule. Mengganti tema bisa mengganti seluruh bahasa visual ikon tanpa menyentuh satu komponen pun. `modules:sync` memvalidasi kelengkapan pemetaan; nama yang tidak tertutup menggagalkan build di CI. |
| L-6 | **[P0]** **Layout sebagai bagian tema.** Layout adalah komponen shell yang mengisi region bernama (`brand`, `nav`, `header`, `breadcrumb`, `content`, `aside`, `footer`) untuk tiga jenis shell: `dashboard`, `public`, `auth`. Tema memilih layout mana yang dipakai untuk tiap jenis. Layout aktif di-resolve saat SSR dan di-code-split — hanya yang aktif yang terunduh klien. |
| L-7 | **[P0]** **Layout kustom oleh developer.** Layout bisa dibuat sendiri dan didaftarkan lewat titik perluasan 15 — dari modul, termasuk modul di repositori lain — lalu dipakai tema mana pun, termasuk tema bawaan core. Membuat layout baru **tidak boleh mengubah berkas core mana pun** dan **tidak boleh menuntut perubahan pada halaman mana pun**. |
| L-8 | **[P0]** Kontrak layout ditegakkan (§4.8): layout tidak mengambil data sendiri (semua lewat props dari `load` core), tidak tahu nama modul, wajib mengisi seluruh region yang dibutuhkan jenisnya, dan wajib memenuhi baseline responsif 360 px + keyboard + kontras WCAG AA. Layout yang tidak memenuhi ditolak saat `modules:sync` dengan pesan yang menyebut region yang kurang. |
| L-9 | **[P0]** **Layout per halaman lewat varian semantik** (§4.8, Keputusan K). Halaman mendeklarasikan `layoutVariant` (`default`, `wide`, `focused`, `split`, atau varian yang didaftarkan modul), dan **tema** yang memetakan varian itu ke layout konkret. Varian yang tidak dipetakan sebuah tema jatuh ke `default` miliknya dengan peringatan di dev — bukan galat. Menyematkan id layout konkret di halaman ditandai lint sebagai halaman yang tidak lagi netral tema. **[P1]** Admin bisa menimpa layout untuk route tertentu dari konfigurasi. |
| L-10 | **[P0]** **Tema baku sistem** ditetapkan admin dari konfigurasi database (`app.default_theme`, per tenant dengan fallback global). Ini yang dilihat pengunjung anonim dan user yang belum memilih. |
| L-11 | **[P0]** **User bebas memilih tema dari daftar yang ditentukan admin.** Admin mengelola allowlist `app.allowed_themes` (per tenant); user memilih bebas di dalam daftar itu, dan pilihannya tersimpan di profil (D-4) + cookie sehingga bertahan lintas sesi dan perangkat. Daftar berisi satu tema = efektif terkunci, tanpa perlu mekanisme terpisah. Menghapus tema dari allowlist memindahkan user yang memakainya ke tema baku pada request berikutnya, tanpa galat. |
| L-12 | **[P0]** Resolusi tema: preferensi user → cookie → tema baku tenant → tema baku global → tema bawaan. Diselesaikan **di server saat SSR**, sehingga halaman pertama sudah tampil dengan warna, ikon, **dan layout** yang benar **tanpa kedipan dan tanpa pergeseran tata letak** — termasuk untuk pengunjung anonim di landing page. |
| L-13 | **[P0]** Pemilih tema tersedia di dashboard **dan** di halaman publik, menampilkan pratinjau, dan bekerja tanpa JavaScript (form action + cookie). |
| L-14 | **[P0]** Modul bisa menyumbang tema, layout, dan set ikon (titik perluasan 14–16); ketiganya otomatis muncul di pemilih dan hilang saat modul dinonaktifkan — **tanpa meninggalkan user pada tema atau layout yang sudah tidak ada** (jatuh ke baku, dengan peringatan tercatat). |
| L-15 | **[P0]** Allowlist `themes.enabled` saat build: proyek hanya mengirimkan tema yang dipakainya beserta layout & set ikon yang dirujuknya, agar banyaknya tema tidak membengkakkan bundle (§4.8). |
| L-16 | **[P0]** **DataTable** sebagai komponen inti: paginasi server-side, pengurutan, pencarian, filter kolom, pilih kolom tampil, aksi baris, aksi massal, serta state kosong/loading/error. Komponen ini **hanya menangani presentasi** — pengambilan data ada di `load` SvelteKit. |
| L-17 | **[P0]** **FormBuilder** berbasis deklarasi field: tipe `string`, `text`, `number`, `boolean`, `date`, `select`, `multiselect`, `file`, `password`, `markdown`. Validasi memakai **skema yang sama dengan API** — satu sumber kebenaran, bukan dua. |
| L-18 | **[P0]** **Enam** layout bawaan tersedia sejak awal: **dashboard** — `sidebar-classic` (sidebar + header + konten), `topnav-compact` (navigasi atas, tanpa sidebar), dan `centered-narrow` (kolom sempit di tengah untuk wizard & form panjang — ini yang menjawab varian `focused` di keempat tema bawaan); **publik** — `marketing-wide`; **auth** — `centered-card` dan `split-hero`. Semuanya responsif sampai 360 px dan menjadi contoh nyata bentuk kontrak layout bagi developer yang membuat layoutnya sendiri. Daftar & region tiap layout ada di `packages/ui-theme/layouts/registry.json`. |
| L-19 | **[P0]** Halaman contoh yang menunjukkan pola: list CRUD, form, detail, chart, kosong, 404, 403, 500. |
| L-20 | **[P0]** Toast/notifikasi, dialog konfirmasi, sheet, dropdown, tabs, skeleton loading. |
| L-21 | **[P0]** **Aksesibilitas**: navigasi keyboard penuh, fokus terlihat, label ARIA, kontras minimal WCAG AA — **diverifikasi pada setiap kombinasi tema × layout bawaan**, bukan hanya pada tema dan layout baku. |
| L-22 | **[P0]** Progressive enhancement — form utama (login, CRUD, kontak, pemilih tema & bahasa) tetap berfungsi tanpa JavaScript lewat SvelteKit form actions. |
| L-23 | **[P1]** Chart (line, bar, area, donut) memakai satu wrapper agar bisa ganti pustaka tanpa mengubah call-site; warnanya dari token tema aktif. |
| L-24 | **[P1]** Editor tema dari UI admin — ubah nilai token, pilih set ikon, pilih layout untuk tiap jenis shell, unggah logo, lalu simpan sebagai tema baru tanpa deploy. Layout dan set ikon yang bisa dipilih hanya yang sudah terdaftar; editor merakit tema, bukan membuat kode. |

### FR-M · Observability & Audit

| ID | Kebutuhan |
|---|---|
| M-1 | **[P0]** Log terstruktur (JSON) dengan **request id** yang mengalir dari web → API → log. |
| M-2 | **[P0]** Audit log untuk aksi sensitif: login/gagal login, perubahan izin, perubahan konfigurasi, CRUD user & tenant. Menyimpan aktor, tenant, IP, dan nilai sebelum/sesudah. |
| M-3 | **[P0]** Log AI (H-9) dengan kebijakan retensi yang dapat dikonfigurasi — tabel log tidak boleh tumbuh tanpa batas. |
| M-4 | **[P0]** Endpoint `/health` (liveness) dan `/ready` (cek DB, dan Redis hanya bila driver Redis aktif — `/ready` tidak boleh merah karena komponen opsional yang memang tidak dipasang). |
| M-5 | **[P0]** Endpoint `/version` — nama app, versi, commit hash, tanggal build, dan daftar modul terpasang beserta versinya. |
| M-6 | **[P1]** Metrik Prometheus: laju request, latensi p50/p95/p99, error rate, koneksi DB. |
| M-7 | **[P0]** Data sensitif (password, token, API key, header `Authorization`, cookie sesi) **wajib disamarkan** di semua log — termasuk ketika nilainya menempel di dalam sebuah PESAN, bukan di field-nya sendiri: galat driver menyertakan parameter kueri yang gagal (`Failed query: … params: …`), sehingga ekornya dipotong sebelum dicatat (`safeMessage()`, `apps/api/src/plugins/request-context.ts`). P0 bersama M-1: penyamaran ditulis di dalam logger sejak awal, karena menambalnya setelah pemanggilan log tersebar berarti memburu setiap call-site — dan yang terlewat baru ketahuan dari log yang sudah bocor. |

### FR-N · Kontrak API & Dokumentasi

| ID | Kebutuhan |
|---|---|
| N-1 | **[P0]** Skema request/response didefinisikan bersama route (TypeBox di Elysia). Validasi runtime, tipe TypeScript, dan OpenAPI **berasal dari definisi yang sama**. Menutup D5 — tidak mungkin lagi ada dokumen basi. |
| N-2 | **[P0]** OpenAPI 3.1 tersaji di `/openapi.json` **saat runtime**, bukan artefak build. UI dokumentasi (Scalar) di `/docs`. Route modul ikut muncul otomatis. |
| N-3 | **[P0]** **Typed client** (Eden Treaty) dipakai SvelteKit — perubahan API yang merusak ketahuan saat `bun check`, bukan saat runtime di produksi. |
| N-4 | **[P0]** Amplop respons konsisten. Sukses: `{ success: true, data, meta? }`. Gagal: `{ success: false, error: { code, message, details? }, requestId }`. `code` adalah string stabil yang bisa dipetakan ke terjemahan di klien. |
| N-5 | **[P0]** Paginasi konsisten: `?page`/`?limit` dengan `meta: { page, limit, total, totalPages }`; cursor untuk daftar besar (mis. pesan chat). |
| N-6 | **[P0]** Versi API di path (`/v1/...`); aturan perubahan yang merusak ditulis di dokumen dan mengikat modul lewat `engines.core` (G-11). |
| N-7 | **[P0]** Header rate limit standar (`RateLimit-*`) dan `429` dengan `Retry-After`. |
| N-8 | **[P1]** Tag tertentu bisa disembunyikan dari dokumen publik. |

### FR-O · Data, Migrasi, & Seed

| ID | Kebutuhan |
|---|---|
| O-1 | **[P0]** Migrasi Drizzle ter-versi, dijalankan lewat perintah **`bun db:migrate`**, aman diulang, dan **ada untuk setiap dialect tier-1**. Migrasi modul ikut alur yang sama. `bun db:push` (schema-push tanpa berkas migrasi) hanya untuk dev dan menolak jalan di `NODE_ENV=production` — jalur produksi selalu `db:migrate` sebagai langkah eksplisit (Q-4). |
| O-2 | **[P0]** `TABLE_PREFIX` opsional, agar beberapa aplikasi bisa berbagi satu database. |
| O-3 | **[P0]** Seed idempoten: superadmin pertama, tenant baku, group baku (Administrator, Regular User), daftar izin, konfigurasi awal (termasuk tema & landing route baku), dan data contoh untuk modul `Example`. |
| O-4 | **[P0]** **Semantik status baris didefinisikan sekali** sebagai konstanta bersama (`status_id`), dipakai seragam di core maupun modul. Tidak boleh ada dua berkas yang mengartikannya berbeda. |
| O-5 | **[P0]** Hapus lunak seragam (`status_id` + `deleted_at`), dengan helper query yang otomatis mengecualikan baris terhapus. |
| O-6 | **[P0]** Semua primary key adalah **UUIDv7 sesuai RFC 9562, di-generate aplikasi** dari **satu fungsi tunggal** di `packages/db` (§4.3.1). Monotonik dalam milidetik yang sama (metode counter RFC 9562 §6.2). Dilarang: `DEFAULT (UUID())` di DDL, generator lokal di modul, dan tipe `UUID` native MariaDB. Lebar kolom netral terhadap versi UUID, sehingga mengganti strategi ID kelak tidak menuntut migrasi skema. |
| O-7 | **[P0]** Perintah backup & restore database yang berjalan di dalam paket deployment (dump terjadwal ke volume, restore satu perintah). Ini kebutuhan operasional self-hosted, bukan kenyamanan dev. |

### FR-P · Developer Experience

| ID | Kebutuhan |
|---|---|
| P-1 | **[P0]** `bun install && bun dev` menjalankan web + API + watcher dalam satu perintah, termasuk `modules:sync` otomatis. |
| P-2 | **[P0]** `docker compose up` menyediakan MySQL untuk dev, plus Valkey sebagai profil opsional (`--profile redis`), tanpa instalasi manual. |
| P-3 | **[P0]** **Pemisahan env yang ditegakkan.** SvelteKit membedakan `$env/static/private` dan `$env/static/public` — hanya variabel ber-prefix `PUBLIC_` yang sampai ke browser. Menutup D2 secara struktural, bukan lewat kedisiplinan. |
| P-4 | **[P0]** Validasi env saat boot memakai skema; proses **gagal cepat** dengan pesan jelas jika ada yang kurang, bukan `undefined` yang menyebar. |
| P-5 | **[P0]** `.env.example` lengkap dan berkomentar, termasuk penjelasan mana yang bisa dipindah ke konfigurasi database. |
| P-6 | **[P0]** **Satu instance koneksi database** diekspor dari `packages/db`. Lint rule melarang instansiasi klien DB di tempat lain. Menutup D3. |
| P-7 | **[P0]** Lint + format + type-check sebagai satu perintah, terpasang di pre-commit dan CI — berlaku juga untuk repositori modul lewat konfigurasi bersama. |
| P-8 | **[P0]** Test: unit (util, RBAC matcher, tenant guard, resolver tema & route), integrasi API (dengan DB nyata via testcontainer), dan minimal satu E2E alur landing → login → CRUD → chat. |
| P-9 | **[P0]** CI menjalankan matriks **tiga dialect tier-1: MySQL 8 + MariaDB 11 + PostgreSQL 16** — satu job per dialect, suite yang sama, tanpa test yang di-skip. Tanpa ini, klaim multi-DB tidak bisa dipercaya. MariaDB diuji terpisah karena perbedaannya dari MySQL nyata (§4.3), bukan kosmetik. |
| P-10 | **[P0]** README + `docs/` yang menjelaskan: cara mulai, cara bikin modul (termasuk di repo terpisah), cara menambah tema, cara mengganti landing page, cara ganti provider AI, dan cara deploy. |
| P-11 | **[P1]** Generator tambahan: tema, migrasi, seed. |

### FR-Q · Deployment & Operasi (self-hosted)

| ID | Kebutuhan |
|---|---|
| Q-1 | **[P0]** `compose.prod.yml` lengkap: web, api, database, Caddy — dengan Valkey sebagai profil opsional yang dimatikan secara baku. Dari VPS kosong ke aplikasi jalan dengan TLS **hanya butuh**: pasang Docker, salin `.env`, `docker compose up -d`. |
| Q-2 | **[P0]** Image container multi-stage, non-root, dengan `HEALTHCHECK`. Ukuran image runtime ditargetkan < 150 MB. |
| Q-3 | **[P0]** Konfigurasi Caddy contoh (TLS otomatis, satu origin, path `/` dan `/v1`) **dan** padanan Nginx bagi yang sudah punya standar sendiri. |
| Q-4 | **[P0]** Migrasi database dijalankan sebagai langkah terpisah yang eksplisit (job/perintah), **bukan otomatis saat container start**. Dua instance yang menyala bersamaan tidak boleh berebut menjalankan migrasi. |
| Q-5 | **[P0]** Build produksi menyertakan langkah `modules:sync` yang deterministik — modul submodule terkunci pada `ref`, sehingga hasil build bisa direproduksi. |
| Q-6 | **[P0]** Restart otomatis saat proses mati (`restart: unless-stopped` atau `Restart=always` di systemd) dan saat host reboot. |
| Q-7 | **[P0]** Rotasi log terkonfigurasi — log JSON tidak boleh memenuhi disk VPS. |
| Q-8 | **[P0]** Backup database terjadwal ke volume/host, dengan retensi dan perintah restore yang terdokumentasi (O-7). |
| Q-9 | **[P0]** **Penyimpanan berkas tersedia sebagai infrastruktur:** volume yang dipetakan di `compose.prod.yml`, jalur dikonfigurasi lewat env, izin direktori benar, dan ikut diperiksa `preflight` (Q-13). Ini P0 karena `compose.prod.yml` dan proses stateless (Keputusan F) sudah mengandaikannya — bukan karena fitur unggah sudah ada. |
| Q-10 | **[P0]** Panduan deployment yang benar-benar diikuti dari nol pada VPS bersih, ditulis sebagai langkah berurutan — bukan potongan konfigurasi lepas. |
| Q-11 | **[P1]** Unit systemd untuk mode tanpa Docker (web & api sebagai service, `EnvironmentFile`, `After=network.target`). |
| Q-12 | **[P1]** Deploy tanpa downtime pada satu host: jalankan versi baru berdampingan, tunggu `/ready` hijau, alihkan proxy, matikan yang lama. |
| Q-13 | **[P1]** Skrip `preflight` yang memeriksa kesiapan sebelum start: env lengkap, DB terjangkau, Valkey terjangkau bila diaktifkan, migrasi mutakhir, modul tersinkron, izin volume benar. Gagal dengan pesan yang bisa ditindaklanjuti. |
| Q-14 | **[P1]** Sumber daya dibatasi per service (`mem_limit`, `cpus`) agar satu container tidak menjatuhkan VPS. |
| Q-15 | **[P2]** Pipeline CD contoh (GitHub Actions → registry → `docker compose pull && up -d` lewat SSH). |
| Q-16 | **[P1]** **Fitur unggah berkas:** endpoint upload dengan validasi tipe & ukuran, tunduk RBAC dan tenancy, plus adapter S3-compatible sebagai opsi di samping volume lokal (Q-9). Dipisah dari Q-9 supaya jelas: MVP menyediakan tempatnya, bukan fiturnya. |

---

## 7. Kebutuhan Non-Fungsional

| Kategori | Target |
|---|---|
| **Performa — SSR** | TTFB < 200 ms (p95, database di host yang sama — asumsi wajar untuk single-VPS). LCP < 2,5 detik pada 4G, termasuk untuk landing page publik. |
| **Performa — API** | p95 < 150 ms untuk endpoint CRUD non-agregat. |
| **Performa — AI** | Token pertama sampai ke UI < 1 detik setelah provider mengirim token pertama (overhead proxy < 100 ms). |
| **Bundle** | JS awal < 150 KB terkompresi untuk halaman dashboard; < 60 KB untuk landing page publik. |
| **SEO** | Halaman publik terindeks penuh tanpa JavaScript; metadata, sitemap, dan data terstruktur valid. |
| **Skalabilitas** | **Stateless penuh.** Bisa dijalankan N instance tanpa sticky session — pertama sebagai `--scale api=N` di satu VPS, lalu lintas-host tanpa perubahan kode. Kriteria terima yang tidak bisa ditawar (menutup D1). |
| **Jejak sumber daya** | Seluruh stack (web + api + MySQL + Caddy, tanpa Valkey pada konfigurasi baku) harus muat dan nyaman di **VPS 2 vCPU / 4 GB**. Idle: total RAM < 1,5 GB. Ini membatasi pilihan desain — tidak ada komponen berat yang ditambahkan tanpa alasan kuat. |
| **Ketersediaan** | Deploy tanpa downtime di satu host (Q-12); migrasi harus kompatibel-mundur satu versi sehingga versi lama dan baru bisa hidup bersamaan sesaat. |
| **Pemulihan** | RPO ≤ 24 jam dengan backup harian baku (bisa diperketat). Restore dari nol terdokumentasi dan pernah diuji, bukan diasumsikan. |
| **Keamanan** | Argon2id untuk password · header keamanan (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) · CORS allowlist tanpa pengecualian otomatis untuk localhost di produksi · rate limit lintas-instance (adapter database baku, Redis opsional — Keputusan M) · validasi input di tepi · parameterized query · sanitasi HTML pada render markdown · tidak ada rahasia di bundle klien |
| **Keamanan modul** | Modul berjalan dalam proses yang sama dengan core — memasang modul pihak ketiga adalah keputusan kepercayaan. Ini ditulis eksplisit di dokumentasi; `modules.json` mengunci `ref` agar isi modul tidak berubah diam-diam. |
| **Privasi** | Log AI menyimpan isi percakapan — harus ada flag untuk mematikannya dan kebijakan retensi. |
| **Aksesibilitas** | WCAG 2.1 AA untuk seluruh halaman inti, **pada setiap tema bawaan** (L-21). |
| **Browser** | Dua versi terakhir Chrome, Firefox, Safari, Edge. |
| **i18n** | Tidak ada string yang di-hardcode di komponen, termasuk di landing page. |
| **Lisensi** | Semua dependensi permisif (MIT/Apache-2.0/ISC/BSD). |

---

## 8. Kriteria Terima (Definition of Done untuk MVP)

Rilis P0 dinyatakan selesai bila **semua** berikut terpenuhi:

1. `bun install && docker compose up -d && bun db:migrate && bun db:seed && bun dev` menghasilkan dashboard yang berfungsi, dari repo bersih, di mesin baru, dalam **< 5 menit**. Jalur bakunya adalah **migrasi ter-versi** (O-1), bukan `db:push` — supaya yang diuji kriteria ini adalah mekanisme yang benar-benar dipakai di produksi (Q-4). `bun db:push` tetap ada sebagai kemudahan dev untuk iterasi skema sebelum migrasinya ditulis, dan **menolak jalan bila `NODE_ENV=production`**.
2. Suite test yang sama **lulus pada MySQL 8, MariaDB 11, dan PostgreSQL 16** di CI — tiga job, tanpa test yang di-skip pada dialect mana pun.
3. `docker compose up -d --scale api=3` — ketiga instance melayani alur login → CRUD → chat tanpa sticky session, tanpa error.
4. `curl` ke `/openapi.json` menghasilkan spesifikasi yang cocok dengan perilaku nyata; klien typed terkompilasi tanpa error.
5. Halaman dashboard ter-render lengkap (menu, tema, bahasa benar) dengan **JavaScript dimatikan**; login, satu alur CRUD, pemilih tema, dan pemilih bahasa tetap berfungsi.
6. Tidak ada nilai rahasia yang muncul di bundle klien — diverifikasi cek otomatis di CI yang men-grep artefak build.
7. Audit dependensi bersih dari kerentanan tingkat tinggi.
8. Lighthouse ≥ 90 untuk Performance, Accessibility, Best Practices, **dan SEO** pada landing page publik; ≥ 90 untuk Performance & Accessibility pada halaman dashboard.
9. Chat AI streaming berjalan, riwayat tersimpan, dan setiap panggilan tercatat dengan token & latensi terisi.
10. Setiap endpoint yang mengubah state terproteksi CSRF; ada test yang membuktikan request lintas-origin ditolak.
11. Sebuah modul baru dibuat lewat `bun modgen` dan langsung berfungsi (tabel dibuat, menu muncul, izin ter-seed, CRUD jalan, terjemahan terpakai, **satu event hook terpanggil, satu job terjadwal berjalan, dan satu widget dashboard muncul** — G-17, G-18, G-19) **tanpa mengedit berkas core mana pun** — dibuktikan otomatis di CI lewat pemeriksaan `git diff` (G-6), bukan inspeksi manual.
12. **Modul AI berjalan sebagai modul**, memakai kontrak yang sama dengan modul pihak ketiga. Menonaktifkannya untuk satu tenant membuat menu, route, dan tool AI-nya hilang — sisa aplikasi tetap utuh. Melepasnya dari `modules.json` membuat aplikasi tetap dibangun dan berjalan tanpa jejak AI.
13. **Modul dari repositori lain berfungsi penuh:** sebuah modul dibuat di repo terpisah lewat `bun create module`, di-build dan dites di sana, lalu dipasang lewat `bun modules:add <git-url>` — tabel, route, menu, izin, i18n, dan temanya bekerja tanpa satu pun berkas core berubah (G-10).
14. Menghapus folder sebuah modul lalu menjalankan `modules:sync` menghasilkan aplikasi yang tetap berfungsi, tanpa route yatim, entri menu rusak, atau user yang terjebak pada tema yang tidak ada.
15. **Landing page komersil `Example` tersaji di `/`** pada instalasi bersih: ter-SSR, terindeks tanpa JavaScript, datanya dari database, form kontaknya bekerja tanpa JavaScript dan emailnya masuk outbox.
16. **Mengubah `app.landing_route` dari UI konfigurasi** langsung mengubah isi `/` tanpa restart dan tanpa deploy; mengarahkannya ke route yang tidak ada ditolak saat disimpan.
17. **Multi-tema terbukti:** minimal 4 tema bawaan bisa dipilih, dan **minimal dua di antaranya berbeda layout dan set ikon**, bukan hanya berbeda warna. Admin menetapkan tema baku sistem; user memilih tema berbeda dan pilihannya bertahan lintas sesi & perangkat; halaman pertama (dashboard maupun landing) ter-render dengan warna, ikon, dan layout yang benar **tanpa kedipan dan tanpa pergeseran tata letak**; kontras setiap kombinasi tema × layout lolos WCAG AA.
18. **Layout kustom terbukti:** sebuah layout dashboard baru dibuat di luar core (dari modul, termasuk modul di repositori lain), didaftarkan, lalu dipilih sebuah tema — dan **seluruh halaman yang ada tetap berfungsi tanpa satu pun diubah**, termasuk halaman milik modul pihak ketiga. Tidak ada berkas core yang berubah (diperiksa lewat `git diff` seperti G-6).
19. **Layout per halaman terbukti:** sebuah halaman mendeklarasikan `layoutVariant: 'wide'` dan tampil dengan layout lebar, sementara halaman lain di aplikasi yang sama tetap memakai layout baku. Mengganti tema mengubah layout konkret yang menjawab varian itu **tanpa mengubah kode halaman**. Berpindah antar halaman dengan varian berbeda tidak menimbulkan kedipan atau hydration mismatch. Tema yang tidak memetakan varian tersebut tetap menyajikan halaman dengan layout `default`-nya, tanpa galat.
20. **Allowlist tema terbukti:** admin menetapkan daftar tema yang boleh dipilih; user hanya melihat dan bisa memilih tema di dalam daftar itu; menghapus sebuah tema dari daftar memindahkan user yang sedang memakainya ke tema baku pada request berikutnya, tanpa galat dan tanpa halaman rusak.
21. **Set ikon terbukti bisa ditukar:** mengganti tema ke tema dengan set ikon berbeda mengubah seluruh ikon aplikasi tanpa perubahan kode; CI menggagalkan build bila ada nama ikon terdaftar yang tidak tertutup sebuah set.
22. Menonaktifkan modul yang menyumbang tema atau layout yang sedang dipakai seseorang tidak membuat halaman rusak — resolusi jatuh ke baku dan peringatannya tercatat (L-14).
23. Dari **VPS bersih** (Ubuntu LTS, hanya Docker terpasang), mengikuti panduan deployment menghasilkan aplikasi yang bisa diakses lewat HTTPS dalam **< 15 menit**, tanpa langkah yang tidak tertulis.
24. Backup diambil, database dihapus, lalu direstore dari backup — aplikasi kembali berfungsi utuh. Diuji, bukan diasumsikan.
25. Seluruh stack berjalan stabil di VPS **2 vCPU / 4 GB** dengan pemakaian RAM idle < 1,5 GB.

---

## 9. Rencana Rilis

| Milestone | Isi | Keluaran yang bisa diuji |
|---|---|---|
| **M0 — Fondasi & Kontrak Modul** | Struktur monorepo, `packages/db` dengan codegen per dialect, `packages/module-kit`, loader env tervalidasi, Elysia + SvelteKit saling terhubung, **kontrak modul §4.5 + `modules:sync` + `modules.json`** (G-1, G-2, G-3, G-7, G-9, G-10), **event bus + penjadwal core (G-17, G-18)**, migrasi & seed (O-1…O-6), DX dasar termasuk harness test unit + integrasi (P-1…P-9), kerangka deployment termasuk restart otomatis, rotasi log, volume unggahan (Q-1…Q-7, Q-9) | `bun dev` jalan; halaman kosong ter-SSR; migrasi jalan di MySQL, MariaDB & PostgreSQL; **satu modul dummy menyumbang tabel + route + halaman + menu + event hook + job terjadwal tanpa mengubah core**; **satu modul dummy kedua dipasang dari repositori git terpisah lewat `modules:add` dan berfungsi sama** (§4.9 poin 1 — ditest di M0, bukan ditunda ke M6); UUIDv7 terbukti monotonik dalam milidetik yang sama; `compose.prod.yml` menyajikan halaman di balik Caddy |
| **M1 — Identitas** | Auth (A-1…A-7, A-10, A-12), tenancy (B-0…B-5), RBAC (C-1…C-7), CRUD user/group/client & profil (D-1…D-4) | Bisa login, kelola user & izin, ganti tenant |
| **M2 — Kerangka UI, Tema, & Layout** | Komponen (L-1, L-16…L-22), **sistem tema lengkap: token, set ikon, layout (L-2…L-15, §4.8)**, i18n (K-1…K-7), menu (F-1…F-4), registry widget dashboard (G-19) | Dashboard terasa lengkap; 4 tema bisa dipilih dan **dua di antaranya berlayout berbeda**; warna, ikon, dan layout benar sejak SSR tanpa kedipan; satu layout kustom dibuat dari luar core dan langsung dipakai |
| **M3 — Konfigurasi, Kontrak, & Halaman Baku** | Konfigurasi runtime (E-1…E-8), **resolusi landing/home route (F-5…F-7, §4.7)**, OpenAPI + typed client (N-1…N-7), observability (M-1, M-4, M-5), penyamaran data sensitif (M-7), audit log (M-2), aktif/nonaktif modul per tenant (G-8) | Admin mengubah setelan, tema baku, dan landing page dari UI; `/docs` akurat |
| **M4 — Modul `Example` & sisi publik** | **Modul `Example` + landing page komersil (R-1…R-8)**, layout publik, SEO, form kontak, outbox email (J-1…J-3) | `/` menyajikan landing komersil ter-SSR dengan data dari DB; Lighthouse ≥ 90 pada keempat kategori (§8 #8); kontrak modul terbukti sanggup melayani halaman publik & tema |
| **M5 — Modul `AI`** | Chat streaming (H-1…H-9), riwayat, log AI — **dibangun sebagai modul** (Keputusan H); E2E penuh landing → login → CRUD → chat (P-8) | Chat berfungsi penuh dengan pencatatan; **kontrak modul terbukti sanggup menopang fitur berat**, atau kekurangannya ketahuan di sini — masih cukup awal untuk diperbaiki |
| **M6 — Modul lintas repositori** | Generator lengkap (G-4), starter modul standalone (G-12), `modules:add` + submodule (G-10), penjaga CI "tanpa ubah core" (G-6), 16 titik perluasan lengkap dengan contoh (G-5), dokumen membangun modul (G-13) | Modul dibuat di repo terpisah, dipasang lewat git URL, langsung jalan; CI menolak perubahan yang menyentuh core |
| **M7 — Pengerasan & Operasi** | Kebijakan retensi log (M-3), backup/restore teruji (O-7, Q-8), panduan deploy (Q-10), dokumentasi (P-10), pembuktian manual kriteria §8 | **Titik rilis MVP:** semua kriteria terima §8 terpenuhi — termasuk uji deploy dari VPS bersih dan uji restore |

Milestone hanya memuat kebutuhan **P0**; rujukan grup (`FR-X`) sengaja tidak dipakai karena menyapu anggota P1/P2. Seluruh P1/P2 — termasuk MCP (FR-I), operasi lanjutan (Q-11…Q-15), dan adapter Redis — diurutkan di [`ROADMAP.md` §8](./ROADMAP.md), satu-satunya rumahnya.

---

## 10. Risiko & Mitigasi

| Risiko | Kemungkinan | Dampak | Mitigasi |
|---|---|---|---|
| **Skema Drizzle tidak portabel lintas dialect** — ini kendala nyata, bukan hipotetis | Tinggi | Tinggi | Deskriptor netral + codegen (§4.3). **Buktikan di M0**, sebelum ada fitur apa pun dibangun di atasnya. Jika terbukti terlalu mahal, turunkan cakupan ke "PostgreSQL + MySQL saja" atau pertimbangkan Kysely |
| **Kontrak modul bocor** — ada kebutuhan modul yang memaksa perubahan core | Tinggi | Tinggi | Dua modul dogfooding dengan sifat berbeda (AI = berat & internal, Example = publik & bertema), dijadwalkan di M4 dan M5 agar kekurangan kontrak ketahuan sebelum modul pihak ketiga menumpuk. Penjaga CI G-6 mengubahnya jadi terukur |
| **Modul lintas repo baru ketahuan sulit di akhir** — karena `@core/*` telanjur jadi alias tsconfig | Sedang | Tinggi | `packages/module-kit` sebagai paket nyata sejak M0; satu modul dummy dari repo terpisah diuji di M0, bukan ditunda ke M6 |
| Ekosistem shadcn-svelte lebih kecil dari padanan React | Sedang | Sedang | Inventarisasi komponen yang dibutuhkan di M0; siapkan anggaran untuk membuat 2–3 komponen sendiri |
| Adapter Bun untuk SvelteKit adalah komunitas, bukan resmi | Sedang | Sedang | Pakai `adapter-node` yang dijalankan di bawah Bun sebagai fallback yang aman |
| Perbedaan perilaku antar dialect lolos ke produksi — termasuk **MariaDB vs MySQL**, yang paling mudah diremehkan karena keduanya dianggap sama | Sedang | Tinggi | CI matriks **tiga** dialect sejak M0, bukan ditambahkan belakangan (P-9). Titik divergensi yang sudah diketahui — JSON, collation baku, tipe UUID — ditutup aturan eksplisit di §4.3, bukan diserahkan pada kehati-hatian |
| **Multi-tema jadi utang perawatan** — komponen baru diam-diam memakai warna hardcoded atau mengimpor glyph langsung, sehingga hanya benar di satu tema | Sedang | Sedang | Lint rule menolak nilai warna literal **dan** impor ikon langsung di komponen; validasi kelengkapan nama ikon + uji kontras otomatis untuk seluruh tema di CI (L-5, L-21) |
| **Ledakan kombinasi tema × layout** — biaya uji dan regresi visual naik berlipat seiring bertambahnya keduanya | Sedang | Sedang | Kontrak region membuat halaman tidak bergantung layout, jadi yang perlu diuji adalah **layout** (sekali per layout) dan **token** (sekali per tema), bukan hasil kali keduanya. Uji visual otomatis dibatasi pada matriks kecil yang ditetapkan: tiap layout × tema baku, plus tiap tema × layout baku |
| **Layout kustom jadi celah aksesibilitas & kebocoran kontrak** — layout pihak ketiga mengambil data sendiri, mengabaikan izin, atau merusak keyboard navigation | Sedang | Tinggi | Kontrak layout melarang pengambilan data (semua lewat props dari `load` core) dan divalidasi saat `modules:sync`; harness uji aksesibilitas wajib dilalui setiap layout terdaftar, termasuk milik modul eksternal (L-8, L-21) |
| **Bundle membengkak karena banyak tema, layout, dan set ikon ikut ter-build** | Sedang | Sedang | Allowlist `themes.enabled` saat build; layout di-code-split dan hanya yang aktif terunduh; set ikon dikirim sebagai sprite per paket (L-15, §4.8) |
| SSR membocorkan data lintas-tenant lewat cache | Rendah | **Kritis** | Tidak ada cache SSR bersama untuk halaman terautentikasi; kunci cache selalu menyertakan tenant + user; test khusus untuk ini. Cache halaman publik hanya untuk route yang ditandai publik |
| Latensi/biaya provider AI tak terduga | Sedang | Sedang | Timeout, circuit breaker, kuota per tenant, dashboard biaya |
| Cakupan membengkak — "sekalian sambil bikin" | **Tinggi** | Tinggi | P0 dikunci pada §5. Ide baru masuk P1/P2, tidak menggeser MVP |
| Tim belum terbiasa Svelte 5 (runes) | Sedang | Sedang | M0 dipakai juga sebagai pemanasan; tetapkan konvensi runes lebih dulu |
| **Single VPS = titik kegagalan tunggal.** Konsekuensi sadar dari pilihan self-hosted | Sedang | Tinggi | Backup terjadwal + restore teruji (O-7, Q-8) · monitoring uptime · jalur naik ke multi-host sudah disiapkan lewat desain stateless, jadi bukan penulisan ulang |
| Streaming AI menahan koneksi lama dan menghabiskan memori pada VPS kecil | Sedang | Sedang | Batas koneksi bersamaan, timeout, pembatasan sumber daya per container (Q-14), pantau di M5 |

---

## 11. Status Keputusan

### 11.1 Sudah diputuskan

| Pertanyaan | Keputusan | Konsekuensi |
|---|---|---|
| Target deployment | **Self-hosted: lokal / VPS.** Bukan serverless, bukan edge | Proses berumur panjang, worker, SSE panjang, dan filesystem lokal boleh dipakai; satu origin untuk web + API (§4.4) |
| Halaman baku ditentukan di mana | **Konfigurasi database**, dengan `LANDING_ROUTE` di `.env` hanya sebagai fallback bootstrap | Bisa diubah admin tanpa restart, bisa berbeda per tenant, wajib divalidasi terhadap registry route (§4.7) |
| Bentuk modul contoh | **`Example` = CRUD referensi + landing page komersil**, dan menjadi isi baku `/` | Menutup titik perluasan halaman publik & tema yang tidak disentuh modul AI (§4.6) |
| Cara modul lintas repositori | **`modules.json` + `git submodule` sebagai jalur baku**, paket npm sebagai alternatif | `@core/*` harus paket nyata sejak M0, bukan alias tsconfig (§4.9) |
| Cakupan tema | **Tema = paket presentasi**: token warna & tipografi, set ikon, aset merek, dan **layout** — bukan sekadar light/dark. Baku sistem diatur admin, user boleh memilih sendiri | Semua warna lewat token, semua ikon lewat nama semantik, semua halaman lewat region layout. Uji kontras & aksesibilitas berlaku untuk setiap kombinasi tema × layout (§4.8, L-2…L-15) |
| Layout kustom | **Developer bisa membuat layout sendiri** dan mendaftarkannya lewat titik perluasan 15, termasuk dari modul di repositori lain | Halaman hanya mengisi region `content` dan tidak boleh tahu layout aktif; layout tidak boleh mengambil data sendiri (§4.8) |
| Kebebasan user memilih tema | **User bebas memilih dari allowlist yang ditentukan admin** (`app.allowed_themes`, per tenant) | Tidak perlu mekanisme "kunci" terpisah — daftar berisi satu tema sudah berarti terkunci. Menghapus tema dari daftar memindahkan pemakainya ke tema baku tanpa galat (L-11) |
| Layout per halaman | **Boleh berbeda tiap halaman, lewat varian semantik** (`layoutVariant`), bukan lewat id layout | Halaman menyebut kebutuhan (`wide`, `focused`), tema yang memetakannya ke layout konkret — sehingga halaman tetap netral tema. Varian tak terpetakan jatuh ke `default` tema, bukan galat (Keputusan K, L-9) |
| Lisensi rilis template | **MIT**, diputuskan 2026-09-10 (menggantikan keputusan internal/proprietary 2026-09-09) — berkas `LICENSE` di root, `"license": "MIT"` di setiap `package.json` workspace | Repositori boleh dipublikasikan; siapa pun boleh memakai, mengubah, dan mendistribusikan asal pemberitahuan hak cipta ikut disertakan. Modul di repositori terpisah tetap boleh berlisensi sendiri (hanya bergantung pada `@core/*` lewat kontrak modul). Dependensi tetap wajib permisif (§9 Lisensi) |
| Multi-tenant & RBAC | **Tetap bagian inti boilerplate**, bukan opsional | Penjaga tenant di lapisan data (B-3) dan instalasi single-tenant harus tetap terasa ringan (B-5) |
| Bentuk isolasi tenant | **Per kolom `client_id`, satu database untuk seluruh tenant.** Tidak ada database/schema/koneksi per tenant | Satu pool, satu migrasi, satu backup; tapi B-3 naik jadi pengaman keamanan utama karena tidak ada batas fisik. Tenant yang butuh isolasi fisik dilayani lewat instalasi terpisah, bukan mode baru di template (§4.3, B-0) |
| Pilihan database server | **Mengikuti dialect yang didukung Drizzle; MySQL 8 sebagai baku dan image `compose.prod.yml`.** MariaDB 11 dan PostgreSQL 16 diuji sejajar di CI; SQLite best-effort; sisanya terbuka tanpa jaminan | Tier ditentukan cakupan uji, bukan preferensi. Menambah dialect = menambah generator di `packages/db`, bukan menyentuh kode domain (§4.3) |
| MariaDB diperlakukan bagaimana | **Dialect tier-1 dengan job CI sendiri**, bukan diasumsikan ikut lolos bersama MySQL | Divergensi yang sudah diketahui ditutup aturan eksplisit: JSON tidak pernah di-query, charset/collation ditulis eksplisit, tipe `UUID`/SEQUENCE/system-versioned native MariaDB dilarang (§4.3, P-9) |
| Bentuk identifier | **UUIDv7 (RFC 9562), di-generate aplikasi dari satu fungsi tunggal** | Terurut waktu dan monotonik dalam milidetik yang sama, jadi aman sebagai clustered PK dan sebagai cursor paginasi. Lebar kolom netral terhadap versi UUID — mengganti strategi ID kelak tidak menuntut migrasi skema (§4.3.1, O-6) |
| Redis/Valkey | **Opsional.** Database adalah backing store baku untuk sesi, cache konfigurasi, dan rate limit | Setiap jenis state punya dua adapter yang keduanya benar di multi-instance; uji `--scale api=3` dijalankan **tanpa** Redis. Tidak boleh ada fitur yang hanya jalan bila Redis ada (Keputusan M) |

### 11.2 Masih terbuka

1. **Siapa pemilik registry harga model AI** untuk perhitungan biaya — hardcoded, tabel konfigurasi, atau ambil dari provider?
2. **Aset merek per tema** (logo, favicon, gambar pratinjau) menunggu identitas visual proyek ditetapkan. Token, set ikon, dan layout keempat tema bawaan sudah final — lihat [`THEMES.md`](./THEMES.md).
3. **Landing page `Example` bergaya apa** — company profile atau e-commerce? Keduanya dicakup §4.6; kalau harus pilih satu untuk MVP, e-commerce sederhana menuntut lebih banyak (katalog, detail, harga) sehingga lebih meyakinkan sebagai bukti kemampuan.

---

## Lampiran A — Permukaan API baseline

Cakupan minimum yang harus tersedia pada rilis P0. Route modul (`/v1/m/<nama>/*`) berada di luar daftar ini dan tumbuh mengikuti modul yang terpasang.

**Grup yang ditandai `[P1]` bukan bagian MVP.** Ia dicantumkan di sini hanya supaya bentuk permukaan API-nya sudah dikunci lebih dulu, sehingga menambahkannya kelak tidak menggeser route yang sudah dipakai klien.

| Grup | Endpoint |
|---|---|
| `auth` | `POST /register` · `POST /login` · `POST /logout` · `GET /csrf-token` · `GET /verify-email` · `GET /google/start` · `POST /google-login` · `GET /join/:code` · `POST /join` |
| `invitations` | `GET /` · `POST /` · `DELETE /:id` (undangan ke tenant aktif, A-13) |
| `auth-public` | `POST /reset-password/request` · `POST /reset-password/validate-token` · `POST /reset-password/confirm` |
| `tokens` | `GET /` · `POST /` · `DELETE /:id` (API token untuk klien non-browser, A-4) |
| `user` | `GET /` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id` · `GET /permission` · `GET /scope` · `GET /profile/me` · `PUT /profile/me` (termasuk preferensi tema & bahasa) |
| `client` | `GET /` · `GET /scope` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id` |
| `groups` | `GET /` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id` |
| `group-permissions` | `GET /:id` · `POST /` · `PUT /:permissionId` · `DELETE /:permissionId` |
| `group-members` | `GET /:id` · `POST /:groupId` · `DELETE /:groupId/:id` |
| `configuration` | `GET /` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id` · `GET /key/:key` · `GET /public` |
| `themes` | `GET /` (registry tema + layout + set ikon yang tersedia, dengan pratinjau) · `GET /:id` · `PUT /me` (pilihan tema user) · `PUT /default` (tema baku sistem, butuh izin admin) |
| `menu` | `GET /` |
| `module` | `GET /` · `PUT /:id/enabled` |
| `mcp` **[P1]** | `POST /initialize` · `POST /tools/list` · `POST /tools/call` · `POST /resources/list` · `POST /resources/read` · `POST /prompts/list` · `POST /prompts/get` — seluruh FR-I P1; I-6 (terautentikasi & tunduk tenancy) adalah prasyarat rilisnya yang wajib dibuktikan test |
| sistem | `GET /health` · `GET /ready` · `GET /version` · `GET /openapi.json` · `GET /docs` |

## Lampiran B — Model data inti

Tabel yang dimiliki core. Modul menambah tabelnya sendiri dengan prefix nama modul (G-9).

`users` · `sessions` · `api_tokens` · `clients` · `client_user_maps` · `groups` · `group_permissions` · `group_user_maps` · `categories` · `configurations` · `modules` · `themes` · `password_reset_tokens` · `email_verification_tokens` · `rate_limits` · `outbox_email` · `audit_log` · `oauth_accounts` (A-8 — identitas eksternal per user, kunci tautan `provider` + `provider_user_id`, bukan email) · `invitations` (A-13 — global dengan `client_id` eksplisit seperti `sessions`, karena kodenya dicari tanpa konteks tenant)

Dua di antaranya dituntut kebutuhan P0 dan sebelumnya belum tercatat di sini: `email_verification_tokens` (A-6 — token verifikasi email; alurnya sejajar `password_reset_tokens`, jadi tidak boleh menumpang tabel yang sama) dan `rate_limits` (penghitung ber-window untuk adapter `database`, yang merupakan driver **baku** rate limit — Keputusan M).

> **`categories` adalah tabel cadangan** — sengaja disiapkan untuk kebutuhan ke depan (taksonomi lintas-modul milik core), dibuat di M0 bersama tabel core lain tapi **belum dipakai fitur P0 mana pun**. Konsekuensi yang harus dijaga: modul **tidak** memakainya — taksonomi milik modul tetap di tabelnya sendiri (`<modul>_categories`, seperti `example_categories`), sesuai G-9. Saat konsumen pertamanya di core muncul, tulis FR-nya lebih dulu, lalu baru kode.

Tabel milik modul `AI`: `ai_conversations` · `ai_messages` · `ai_message_attachments` · `ai_log` · `ai_mcps` · `ai_mcp_tools`
Tabel milik modul `Example`: `example_products` · `example_categories` · `example_inquiries`

Seluruhnya memakai PK UUIDv7 (O-6), `status_id` + `deleted_at` untuk hapus lunak (O-5), dan prefix tabel opsional lewat `${TABLE_PREFIX}` (O-2).

Kolom `client_id` ada pada tabel **ber-tenant**, bukan pada semuanya — dan pengecualiannya disengaja:

- `clients` tidak punya `client_id`; hierarkinya lewat `parent_id` (B-1).
- `configurations` membolehkan `client_id IS NULL` sebagai nilai global yang jadi fallback saat tenant belum menimpanya (E-2). Pola yang sama berlaku untuk `themes` dan `modules`.
- `rate_limits` global: dikunci per identitas pemanggil lewat `key` unik (`login:ip:…`, `tenant:<id>:api:<user>`). Bukan `client_id` nullable — NULL dalam unique index tidak unik di MySQL maupun PostgreSQL.
- `sessions` dan `api_tokens` punya `client_id` dengan arti **tenant aktif**, bukan kepemilikan; keduanya tabel global dan tidak disaring penjaga tenant.

Selain pengecualian di atas, tabel ber-tenant wajib `client_id` **dan** indeks yang diawali `client_id` (B-0).
