# 404 Trapper Roadmap — Modul Menangani URL yang Tidak Dikenal

| | |
|---|---|
| **Status** | **Selesai F0–F2** (2026-09-25, hari yang sama dengan rencananya). F3 (CRUD kategori) tidak dikerjakan — opsional. Bukti: `bun test` (unit `trap.test.ts`), `INTEGRATION=1` `example.test.ts` + `config.test.ts`, gate M4 blok **F-11** di `scripts/m4-gate-proof.ts`. Catatan pelaksanaan di §11 |
| **Pemilik** | Core (`apps/web/src/hooks.server.ts`, `packages/settings`) untuk mekanismenya; modul `Example` (`modules/Example/`) sebagai pemakai rujukan |
| **Bergantung pada** | `docs/PRD.md` §4.7 (resolusi route baku, F-5/F-6), §4.5 titik perluasan 6 (config) dan 13 (halaman publik), G-8 (modul aktif per tenant), F-7 (sitemap); `docs/MODULES.md` §3 `public.ts`; `docs/ROADMAP.md` §8 |
| **Isu pemicu** | Toko daring dan blog memakai URL tingkat akar tanpa awalan — `/furniture/`, `/sanitary/`, `/kotak-penyimpanan-…-p-blue/` — yang hari ini pasti 404 karena tidak ada route SvelteKit yang cocok, dan modul tidak punya jalan untuk "mengklaim" URL semacam itu tanpa menyentuh core |

## 1. Ringkasan

Tambahkan satu setelan, **`app.not_found_route`**, di **Pengaturan → Aplikasi**, tepat di bawah *Halaman depan (anonim)* dan *Halaman setelah masuk*. Nilainya adalah **halaman publik milik modul** (titik perluasan 13) yang akan dicoba **setiap kali** sebuah request GET HTML tidak cocok dengan route mana pun. Modul menerima path aslinya, memutuskan sendiri apakah itu kategori, produk, artikel, atau bukan miliknya, lalu merender halaman (status **200**, alamat di browser tidak berubah) atau melempar 404 lagi sehingga **404 bawaan sistem tetap tampil**.

Bawaannya **kosong = 404 bawaan**, persis permintaan. Tidak ada tipe field baru, tidak ada titik perluasan baru, tidak ada perubahan kontrak modul: mekanismenya adalah **pola landing page (F-5/F-6) yang dipakai ulang dengan pemicu berbeda**.

| | Landing page (ada) | 404 trapper (baru) |
|---|---|---|
| Pemicu | `GET /` oleh pengunjung **anonim** | `GET` HTML ke path yang **tidak cocok route mana pun**, siapa pun pengunjungnya |
| Setelan | `app.landing_route` (`public_route`) | `app.not_found_route` (`public_route`) |
| Sasaran | halaman publik modul | halaman publik modul |
| Cara sampai | `event.fetch` internal ke sasaran, HTML-nya dikembalikan sebagai `/` | `event.fetch` internal ke sasaran **+ header path asli**, HTML-nya dikembalikan sebagai path asli |
| Bila sasaran gagal | halaman depan bawaan + `warn` | 404 bawaan; `warn` hanya bila sasaran 5xx |
| Bawaan | `LANDING_ROUTE` di `.env` → `/example` | kosong (404 bawaan), **tanpa** fallback `.env` — bukan kebutuhan bootstrap (E-6) |

## 2. Gap hari ini

1. **Tidak ada jalan mengklaim path akar.** `definePublicRoutes` hanya menerima bentuk `/segmen/[param]` (`packages/module-kit/src/contract.ts:455`, `PUBLIC_PATH_RE`) — sengaja: catch-all `[...slug]` hanya bisa dimiliki satu modul dan bertabrakan dengan modul lain. Jadi `/furniture` tidak mungkin dideklarasikan modul mana pun.
2. **404 hari ini final.** `hooks.server.ts` langsung `resolve(event)`; path tak dikenal jatuh ke `apps/web/src/routes/+error.svelte` (L-19). Tidak ada titik untuk bertanya pada modul.
3. **Pola forward sudah ada tapi terikat pada `/`.** Blok landing di `hooks.server.ts:44` dan `landingTarget()` di `hooks.server.ts:125` sudah melakukan persis yang dibutuhkan (validasi route ke registry, cek modul aktif, `event.fetch` internal, kembalikan HTML-nya, fallback aman dengan `warn`) — hanya pemicunya yang perlu digeneralisasi.
4. **Kekurangan kecil yang sudah ada dan akan ikut tersorot:** loader `(public)/+layout.server.ts:26` mengembalikan `path` dari `event.url`, sehingga di halaman yang diteruskan (hari ini: landing) dropdown bahasa (K-7) kembali ke path *sasaran* (`/example`), bukan path yang dilihat pengunjung (`/`). Untuk trapper ini fatal: kembali ke `/resolve` = 404.

## 3. Keputusan desain

**Keputusan A — pemicu adalah "tidak ada route yang cocok", diperiksa sebelum render.** Di dalam `handle`, `event.route.id === null` berarti SvelteKit tidak menemukan route. Ini diperiksa **sebelum** `resolve(event)`, jadi 404 bawaan tidak dirender sia-sia lebih dulu. Halaman yang route-nya cocok tetapi loader-nya melempar 404 (mis. `/product/slug-tak-ada`, `/users/id-asing`) **tidak** dijebak — itu 404 milik halaman tersebut dan harus tetap begitu.

**Keputusan B — berlaku untuk semua pengunjung, bukan hanya anonim.** Berbeda dari landing: pelanggan yang sudah masuk pun harus bisa membuka `/furniture`. Halaman publik sudah tahu cara tampil untuk keduanya (`loggedIn` di layout publik, L-12).

**Keputusan C — path asli dikirim lewat header, bukan query.** Request internal ke sasaran membawa `x-original-path: /furniture?page=2`. Query akan mencemari `event.url` halaman sasaran dan ikut ke tautan yang ia render; header tidak. Modul membacanya lewat **helper yang diketik**, `trappedPath(event)`, bukan string header mentah (nama header adalah detail implementasi core).

**Keputusan D — yang dijebak hanya GET yang meminta HTML, di luar prefix sistem.** Aset, API, dan prefix core tidak pernah sampai ke modul: `/_app`, `/v1`, `/api`, `/m`, `/auth`, `/files`, `/join`, `/.well-known`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, plus seluruh `RESERVED_PUBLIC` (`contract.ts:457`). Ini juga yang menahan pemindai bot (`/wp-admin`, `/.env`) dari memicu query modul — sebagian besar pola bot justru diawali titik atau prefix yang sudah terlarang.

**Keputusan E — loop guard wajib.** Request internal ke sasaran melewati `handle` lagi. Bila sasaran sendiri 404 (modul dinonaktifkan sesudah setelan disimpan), request itu **tidak boleh** dijebak ulang: keberadaan header `x-original-path` menghentikan jebakan.

**Keputusan F — status respons.** Sasaran 200 → dikembalikan **200** di bawah path asli (produk/kategori memang ada; mesin pencari harus mengindeksnya). Sasaran 404 → `resolve(event)` biasa → 404 bawaan, **tanpa** `warn` (ini jalur normal "bukan milik saya"). Sasaran 5xx / gagal fetch → `warn` satu baris JSON dengan `requestId`, lalu 404 bawaan (F-6: front door tidak pernah 500 gara-gara trapper). Redirect (3xx) dari sasaran diteruskan apa adanya.

**Keputusan G — kategori vs produk adalah urusan modul.** Core hanya menyerahkan path. Modul `Example` menunjukkan polanya dengan satu endpoint `GET /v1/m/example/resolve?path=…` yang mencocokkan slug kategori lebih dulu, lalu slug produk.

## 4. Alur request

```
GET /furniture  (Accept: text/html)
  └─ handle()
       ├─ event.route.id === null?  ya
       ├─ GET + accept html + bukan prefix sistem + tanpa x-original-path?  ya
       ├─ target = routeTarget(cfg 'app.not_found_route', enabledModules)   // null → lanjut ke resolve()
       ├─ event.fetch(target, { headers: { accept, cookie, 'x-original-path': '/furniture' } })
       │     └─ handle() lagi → x-original-path ada → TIDAK dijebak → halaman /resolve dirender
       │           └─ load(): trappedPath(event) = '/furniture'
       │                 └─ GET /v1/m/example/resolve?path=/furniture → { kind: 'category', … } | 404
       ├─ 200  → Response(html, { status: 200, headers + x-not-found-route: target })   ← selesai
       ├─ 404  → resolve(event) → +error.svelte 404 bawaan
       └─ 5xx  → warn(JSON) → resolve(event) → 404 bawaan
```

## 5. Perubahan yang dibutuhkan

### 5.1 Registry setelan — `packages/settings/src/registry.ts:70`

Satu entri baru di section `app`, `order: 4` (geser `app.default_theme` dst. satu angka), bertipe `public_route`, `default: null`, `public: true` (hooks membaca config publik dari cache API, `loadPublicConfig`):

```ts
{
  key: 'app.not_found_route',
  type: 'public_route',
  title: { id: 'Penangkap halaman 404', en: '404 handler' },
  note: {
    id: 'Halaman publik modul yang dicoba untuk setiap URL yang tidak dikenal (kategori, produk, artikel). Modul menerima path aslinya; bila ia pun tidak mengenalnya, halaman 404 bawaan tampil. Kosongkan untuk memakai 404 bawaan.',
    en: 'A module public page tried for every unknown URL (categories, products, posts). The module receives the original path; when it does not know it either, the built-in 404 shows. Leave empty for the built-in 404.',
  },
  default: null,
  public: true,
  order: 4,
},
```

Validasi (`packages/settings/src/validate.ts:91`), penyempitan per lingkup (`apps/api/src/domains/configuration.ts:194`, `publicRoutesForModules`), dan form ter-generate di `/settings` **tidak berubah** — semuanya sudah bekerja per tipe, bukan per kunci (E-3). Tambahkan juga kuncinya ke `defaults()` di `apps/web/src/lib/server/config.ts` (nilai `null`) agar bentuk config publik konsisten saat API tak terjangkau.

### 5.2 Hooks — `apps/web/src/hooks.server.ts`

1. Ganti nama `landingTarget()` (`:125`) menjadi `routeTarget()`; isinya sudah generik (validasi ke `webRoutes`, cek pemilik modul aktif lewat `moduleOwning()`, `warn` bila route hilang). Pesan `warn`-nya diberi parameter `setting` agar log menyebut kunci mana yang salah.
2. Keluarkan daftar prefix sistem ke satu konstanta `NEVER_TRAPPED` (Keputusan D), dites unit.
3. Tambahkan blok jebakan **sebelum** `resolve(event)`, setelah blok landing:

```ts
// 404 trapper (§4.7 rule 6): an unknown path is offered to the configured module page before the
// built-in 404 renders. Same forward pattern as the landing route; the module learns the original
// path from a header, so its own URL never leaks into the page it renders.
if (
  event.route.id === null &&
  event.request.method === 'GET' &&
  wantsHtml(event.request) &&
  !NEVER_TRAPPED.some((p) => event.url.pathname === p || event.url.pathname.startsWith(`${p}/`)) &&
  !event.request.headers.has('x-original-path') // loop guard: the forwarded request is never trapped again
) {
  const target = routeTarget('app.not_found_route', cfgString(event.locals.config, 'app.not_found_route', ''), event.locals.config.enabledModules);
  if (target) {
    const forwarded = await event.fetch(new URL(target, event.url.origin), {
      headers: {
        accept: 'text/html',
        cookie: event.request.headers.get('cookie') ?? '',
        'x-original-path': event.url.pathname + event.url.search,
      },
      redirect: 'manual',
    });
    if (forwarded.ok || (forwarded.status >= 300 && forwarded.status < 400)) {
      const headers = new Headers(forwarded.headers);
      headers.set('x-request-id', event.locals.requestId);
      headers.set('x-not-found-route', target);
      return new Response(await forwarded.text(), { status: forwarded.status, headers });
    }
    if (forwarded.status >= 500) console.warn(JSON.stringify({ level: 'warn', msg: '404 trapper gagal merender — memakai 404 bawaan (F-6)', target, status: forwarded.status, path: event.url.pathname, requestId: event.locals.requestId }));
    // 404 from the handler is the normal "not mine" answer — fall through silently.
  }
}
```

`wantsHtml()` = header `accept` memuat `text/html` atau `*/*` tanpa `application/json`. Semua komentar dalam bahasa Inggris (AGENTS.md).

### 5.3 Helper untuk modul — `apps/web/src/lib/server/trap.ts` (baru)

```ts
/** The path the visitor actually requested when this page renders as a 404 handler; null on a direct visit. */
export function trappedPath(event: RequestEvent): { pathname: string; search: string } | null
```

Memarsing `x-original-path`, menolak nilai yang tidak diawali `/` atau diawali `//`. Modul mengimpornya seperti helper server lain (`$lib/server/session` sudah dipakai halaman publik modul, lihat `modules/Example/web/public/product/[slug]/+page.server.ts`).

### 5.4 Layout publik — `apps/web/src/routes/(public)/+layout.server.ts:26`

`path` (tujuan kembali dropdown bahasa dan tema) memakai `trappedPath(event)` bila ada, baru `event.url`. Sekaligus rapikan landing: bila header tidak ada tetapi request datang dari forward landing, gunakan `/` — cara termurah: blok landing di 5.2 **juga** mengirim `x-original-path: /`, sehingga satu aturan menutup keduanya. Tambahkan `<link rel="canonical">` dari path yang sama di layout publik bila belum ada.

### 5.5 Modul `Example` — pemakai rujukan (R-9: satu modul, lebih dari satu bentuk halaman publik)

1. **Tabel `example_categories`** (baru, `modules/Example/db/tables.ts`): `id`, `client_id`, `slug` (`identifier(120)`, unik per `client_id` seperti `example_products.slug` di `tables.ts:26`), `name`, `description`, `sort`, `deleted_at`. Kolom `category_id` nullable di `example_products`. Migrasi aditif hasil `bun db:generate` (mysql/pg/sqlite). Seed (`seed.ts`, O-3, idempoten): dua kategori — `furniture`, `sanitary` — dan produk seed diberi kategori.
2. **Endpoint `GET /v1/m/example/resolve?path=`** di `modules/Example/api/routes.ts`, publik, tanpa sesi: normalisasi path (buang trailing slash, decode, batasi 200 karakter), satu segmen saja; cocokkan kategori → `{ kind: 'category', category, products[] }`; kalau tidak, produk → `{ kind: 'product', product }` (bentuk sama dengan `/products/:slug`, `routes.ts:151`); kalau tidak, **404**. Dua query terindeks paling banyak.
3. **Halaman publik `/resolve`** (`public.ts` + `web/public/resolve/`): `sitemap: false`. Loader: `trappedPath(event)` null → `error(404)`; panggil `resolve`; render `Category.svelte` (daftar produk, memakai komponen katalog yang sudah ada) atau komponen detail produk yang sama dengan `/product/[slug]`. Judul, deskripsi, dan `og:*` dari data.
4. **Sitemap** (`routes.ts:202`, F-7): tambahkan `/<category.slug>` dan `/<product.slug>` ke keluaran `/sitemap` **hanya bila** setelan `app.not_found_route` tenant itu mengarah ke `/resolve` — jika tidak, URL tersebut memang 404 dan tidak boleh masuk sitemap. Endpoint membaca nilainya lewat `configValue()` seperti setelan modul lain.
5. **CRUD kategori** di dasbor (`/m/example/categories`) — *opsional*, fase terpisah; seed cukup untuk pembuktian.
6. **i18n** `modules/Example/i18n/{id,en}.json`: judul kategori, "N produk", breadcrumb.

### 5.6 Dokumen — pada commit yang sama (ROADMAP §7 butir 7)

- `docs/PRD.md` §4.7: baris tabel `app.not_found_route` + **aturan resolusi 6**: "URL yang tidak cocok route mana pun ditawarkan ke `app.not_found_route` (bila diisi) sebelum 404 bawaan; sasaran yang 404 mengembalikan 404 bawaan, sasaran yang gagal dicatat sebagai peringatan dan tidak pernah menjadi 500." Nomor FR-nya **F-11** (F-9 dan F-10 sudah terpakai).
- `docs/MODULES.md` §3 `public.ts`: sub-bagian **"Menangkap URL tak dikenal (404 trapper)"** — kontrak `trappedPath()`, keharusan `error(404)` pada kunjungan langsung, pola sitemap bersyarat.
- `docs/ROADMAP.md` §8: butir baru merujuk dokumen ini.
- `.env.example`: tidak berubah (tidak ada kunci `.env`).

## 6. Fase & estimasi

| Fase | Isi | Gate |
|---|---|---|
| **F0 — Setelan & jebakan** | 5.1, 5.2, 5.3, 5.4; unit test `NEVER_TRAPPED` + `wantsHtml` + `trappedPath`; tes validasi `public_route` sudah mencakup kunci baru tanpa diubah | Tes integrasi web baru `apps/web/test/integration/not-found-trap.test.ts` (mengikuti `config.test.ts`): setelan disimpan lewat API → `GET /apa-saja` mengembalikan HTML sasaran dengan `x-not-found-route`; setelan kosong → 404 bawaan; `GET /v1/nope` dan `GET /_app/x` tidak tersentuh; `Accept: application/json` tidak dijebak; sasaran yang modulnya dinonaktifkan → 404 bawaan + tidak berputar (satu `x-original-path`) |
| **F1 — Modul Example** | 5.5 butir 1–4, 6; seed kategori | `example.test.ts` diperluas: `/furniture` → 200 + nama kategori + produk seed; `/<slug-produk>` → 200 + detail produk yang identik dengan `/product/<slug>`; `/tidak-ada` → 404; `/resolve` langsung → 404; `sitemap.xml` memuat `/furniture` hanya saat setelan diisi |
| **F2 — Dokumen & bukti UI** | 5.6; proof Playwright: admin mengisi setelan dari `/settings` tanpa JS, membuka `/furniture`, dropdown bahasa kembali ke `/furniture` | `bun run check`, `bun run lint`, gate M3 (form ter-generate) dan M4 (Lighthouse landing ≥ 90 — tidak boleh turun; landing tidak disentuh) hijau |
| **F3 — CRUD kategori** *(opsional)* | 5.5 butir 5 | Mengikuti pola `/m/example/products` |

Perkiraan: F0 **1 hari**, F1 **1–1,5 hari**, F2 **0,5 hari**; F3 **1 hari** bila diminta. F0 bisa di-merge sendiri: tanpa modul yang memakainya, setelan hanya menawarkan `/example`, `/catalog`, `/hello-dummy` sebagai sasaran dan tetap berperilaku benar (sasaran tanpa `trappedPath` cukup merender dirinya — `/example` sebagai "halaman 404 bermerek" adalah kasus guna yang sah).

## 7. Kriteria terima

1. `app.not_found_route` tampil di **Pengaturan → Aplikasi** di bawah *Halaman setelah masuk*, hanya menawarkan halaman publik modul yang aktif di lingkup itu (§4.7 aturan 1–2), dan menolak nilai lain bila dikirim langsung ke API.
2. Setelan kosong (bawaan): perilaku 404 hari ini **byte-identik** — `+error.svelte`, status 404, tanpa request internal tambahan.
3. Setelan diisi `/resolve` (Example): `/furniture` dan `/kotak-penyimpanan-…` menjawab **200** dengan konten modul, alamat di browser tidak berubah, tanpa redirect, tanpa JavaScript.
4. Path yang tidak dikenali modul tetap **404 bawaan**; tidak ada `warn` di log untuk kasus ini.
5. Aset, API, prefix core, dan request non-HTML **tidak pernah** diteruskan ke modul.
6. Modul dinonaktifkan sesudah setelan disimpan → 404 bawaan + satu `warn` "route tidak ada / modul nonaktif", tanpa loop, tanpa 500.
7. Dropdown bahasa dan tema di halaman hasil jebakan kembali ke path asli.
8. `sitemap.xml` memuat URL kategori/produk akar hanya saat trapper mengarah ke modul itu.
9. Semua request yang dijebak membawa `x-request-id` yang sama di web dan API (M-1).

## 8. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Bot memindai ribuan path acak → satu query resolver per 404 | Prefix sistem tidak pernah dijebak (D); resolver dua query terindeks dengan `LIMIT 1`; rate limit per IP yang sudah ada di API berlaku untuk `/resolve`; cache negatif 60 s di `@core/cache` bila terbukti perlu |
| Loop forward tak berujung | Loop guard lewat header (E) + tes integrasi yang menghitung hop |
| Halaman sasaran melempar 500 → front door 500 | 5xx dari sasaran selalu jatuh ke 404 bawaan (F); dicatat sebagai `warn`, bukan `error` |
| `event.fetch` internal tidak membawa konteks tenant | Cookie diteruskan (sama seperti landing); tenant anonim = global, sama dengan request aslinya |
| Trailing slash: `/furniture/` (bentuk di request) | `trailingSlash` SvelteKit bawaan `never` → 308 ke `/furniture` **sebelum** jebakan; resolver tetap menormalkan keduanya. Kalau pemilik ingin URL kanonik berakhiran `/`, itu setelan `trailingSlash` di `svelte.config.js`, di luar lingkup ini |
| Halaman sasaran merender tautan relatif terhadap `/resolve` | Semua tautan modul sudah absolut (`/product/…`, `/catalog`); ditegaskan di MODULES.md |
| Tabrakan slug: kategori dan produk bernama sama | Kategori menang (urutan resolver); dicatat di dokumen modul, bukan masalah core |
| Registry `webRoutes` tidak memuat `/resolve` bila `modules:sync` belum dijalankan | Sama dengan landing hari ini: `routeTarget()` menolak + `warn`; gate CI `modules:sync` sudah menjaga |

## 9. Alternatif yang tidak diambil

- **Route catch-all `[...slug]` yang dideklarasikan modul** — ditolak `PUBLIC_PATH_RE` dengan sengaja: hanya satu modul yang bisa memilikinya, dua modul bertabrakan saat sync, dan admin tidak bisa memindahkannya per tenant dari Pengaturan.
- **Hook `reroute` SvelteKit** — berjalan juga di klien, jadi butuh tabel route dan nilai setelan di browser; pemetaan path harus sinkron antara dua runtime. Terlalu berat untuk kebutuhan yang sepenuhnya server-side (§4.7 aturan 5).
- **`handleError`** — hanya dipanggil untuk galat tak terduga, tidak bisa mengganti isi respons, dan 404 route-miss bukan galat.
- **Tipe field baru `not_found_route`** — tidak menambah apa pun di atas `public_route`; sasaran memang harus halaman publik (harus bisa dibuka tanpa sesi).
- **Query `?path=` alih-alih header** — mencemari `event.url` halaman sasaran dan ikut terbawa ke tautan yang ia render (Keputusan C).
- **Menjebak sesudah `resolve()` dengan memeriksa `response.status === 404`** — merender 404 bawaan sia-sia untuk setiap request, dan ikut menjebak 404 milik halaman yang route-nya cocok (Keputusan A).

## 10. Rujukan implementasi

| Apa | Di mana |
|---|---|
| Blok forward landing yang ditiru | `apps/web/src/hooks.server.ts:44` |
| `landingTarget()` → `routeTarget()` | `apps/web/src/hooks.server.ts:125` |
| `moduleOwning()` (pemilik route publik) | `apps/web/src/hooks.server.ts:153` |
| Entri `app.landing_route` yang menjadi contoh | `packages/settings/src/registry.ts:70` |
| Validasi `public_route` | `packages/settings/src/validate.ts:91` |
| Penyempitan pilihan per lingkup (API) | `apps/api/src/domains/configuration.ts:194`, `:272` |
| Bawaan config publik sisi web | `apps/web/src/lib/server/config.ts` (`defaults()`) |
| `path` untuk dropdown bahasa/tema | `apps/web/src/routes/(public)/+layout.server.ts:26` |
| Kontrak halaman publik, prefix terlarang | `packages/module-kit/src/contract.ts:455` (`PUBLIC_PATH_RE`), `:457` (`RESERVED_PUBLIC`), `:475` (`definePublicRoutes`) |
| Deklarasi halaman publik Example | `modules/Example/public.ts` |
| Loader halaman publik modul (pola impor `$lib/server/*`) | `modules/Example/web/public/product/[slug]/+page.server.ts` |
| Endpoint produk by slug & sitemap dinamis | `modules/Example/api/routes.ts:151`, `:202` |
| Slug produk + indeks unik per tenant | `modules/Example/db/tables.ts:14`, `:26` |
| 404 bawaan | `apps/web/src/routes/+error.svelte` |
| Pola tes integrasi web | `apps/web/test/integration/config.test.ts`, `example.test.ts` |

## 11. Catatan pelaksanaan (2026-09-25)

Sesuai rencana, dengan penyesuaian kecil yang ditemukan saat mengerjakan:

- **Nomor FR: F-11**, bukan F-9 (sudah terpakai oleh command palette).
- **Tanpa FK** pada `example_products.category_id` — soft-delete kategori tidak boleh berimbas ke produk, dan nama constraint hasil generate mendekati batas 64 karakter MySQL begitu `TABLE_PREFIX` menempel di kedua nama tabel. Indeks `(client_id, category_id)` tetap ada. Migrasi: `0030_*` (mysql, pg), `0004_*` (sqlite), semuanya aditif.
- **Kategori seed:** `single-origin` (empat produk) dan `blend` (`house-blend`) — bukan `furniture`/`sanitary` dari contoh permintaan, karena data demo modul adalah kopi. Produk yang sudah tersemai sebelum kolom ada diberi kategori sekali oleh seed (hanya bila masih `NULL`).
- **`<svelte:head>` tidak boleh berada di dalam `{#if}`** — halaman `/resolve` menaruh head kategori di tingkat atas dengan `{#if}` di dalamnya; head produk berasal dari `ProductDetail.svelte`.
- **Komponen bersama** `modules/Example/web/public/_lib/ProductDetail.svelte` (diimpor relatif oleh `/product/[slug]` dan `/resolve`; sync tidak menyalin folder `_lib`, shim mengimpor sumbernya langsung sehingga impor relatif jalan).
- **`GET /v1/m/example/categories`** ditambahkan (daftar kategori publik) walau halaman belum memakainya — untuk F3 kelak.
- **Landing ikut mengirim `x-original-path: /`**, jadi form bahasa di landing yang diteruskan kini kembali ke `/`, bukan `/example` (kekurangan lama di §2 butir 4).
- **Header `accept`:** hanya `text/html`/`application/xhtml+xml` yang dijebak; `*/*` polos (curl, fetch baku) tidak — bot pemindai mendapat 404 bawaan tanpa query modul.
- **Jebakan lingkungan lokal:** `APP_ORIGIN` di `.env` bocor ke `bun test` dan menolak origin `http://api.test` pada POST di suite integrasi (403); jalankan dengan `APP_ORIGIN=http://api.test INTEGRATION=1 bun test …`. Bukan regresi — suite yang tidak disentuh gagal dengan cara yang sama.
