# Membangun Modul Pertama Anda

| | |
|---|---|
| **Status** | Versi 2 — kontrak M6. Semua titik perluasan yang bisa dipakai hari ini ada di §2a; yang belum ada ditandai di §6 dan tidak boleh diasumsikan |
| **Kontrak lengkap** | [`PRD.md` §4.5](./PRD.md) (16 titik perluasan), §4.9 (modul lintas repositori), FR-G |
| **Contoh hidup** | [`modules/Example/`](../modules/Example) (referensi publik + CRUD), [`modules/AI/`](../modules/AI) (fitur berat, SSE, job), [`modules/Dummy/`](../modules/Dummy) (tema/layout/ikon), dan modul hasil `bun modgen` |
| **Jalur tercepat** | `bun modgen <Nama> --fields "name:string!,qty:number"` → modul lengkap yang langsung jalan (§2) |

Dokumen ini adalah tempat yang perlu Anda baca untuk membuat modul. Kalau ada langkah yang ternyata membutuhkan perubahan pada berkas di luar `modules/` dan `modules.json`, itu **cacat pada kontrak modul** (PRD §3 prinsip 6) — laporkan, jangan tambal core.

---

## 1. Tiga aturan yang tidak bisa ditawar

1. **Modul adalah paket nyata.** Ia punya `package.json` sendiri dan mengimpor core lewat nama paket — `@core/db`, `@core/module-kit`, `@core/contracts` — bukan path relatif ke `packages/`. Karena itu ia bisa dipindah folder, atau dipindah ke repositori lain, tanpa rusak. Konsekuensinya keras: **apa pun yang Anda impor harus Anda deklarasikan** sebagai dependensi; kalau tidak, `modules:sync` gagal dengan `Cannot find package`.
2. **Semua yang Anda sumbangkan memakai namespace Anda.** Untuk modul bernama `Billing`, namespace-nya `billing`: tabel `billing_*`, izin `billing.*`, id menu `billing.*`, route API otomatis di `/v1/m/billing/*`, halaman di `/m/billing/*`. Ini ditegakkan `modules:sync`, bukan disepakati — pelanggaran menggagalkan sync dengan pesan yang menyebut modul Anda, dan bentrokan menyebut kedua modul.
3. **Core tidak tahu nama modul Anda.** Tidak ada `import` ke modul di mana pun di core; core hanya mengimpor berkas hasil `modules:sync`. Menambah atau mencabut modul = mengubah `modules.json` + menjalankan sync. Titik.

---

## 2. Dari nol sampai jalan — 2 menit dengan `bun modgen`

```bash
bun modgen Billing --resource invoice \
  --fields "number:string!,amount:number,paid:boolean,notes:text,kind:select(sale|refund),due:date" \
  --public
```

Satu perintah menghasilkan **modul utuh** di `modules/Billing/` dan mendaftarkannya di `modules.json` — tanpa berkas core mana pun berubah (CI menjaganya, lihat §8):

| Berkas | Isi |
|---|---|
| `db/tables.ts` | tabel `billing_invoices` (tenant-scoped, soft delete) dari daftar field |
| `permissions.ts` · `menu.ts` | `billing.invoice.read/create/edit/manage`; entri menu `/m/billing/invoices` yang tampil hanya bila izin ada |
| `config.ts` · `i18n/{id,en}.json` | section "Billing" di Pengaturan (form otomatis); kunci `billing.*` untuk kedua bahasa |
| `api/schemas.ts` · `api/routes.ts` | skema TypeBox bersama + CRUD `/v1/m/billing/invoices` lewat facade tenant, teraudit, dengan pencarian & paginasi |
| `api/tools.ts` | tool AI/MCP `billing.list_invoices` — ditawarkan ke asisten AI hanya bagi user yang punya `billing.invoice.read`, berjalan di tenant aktif |
| `web/routes/invoices/**` | halaman daftar, buat, ubah/hapus — `FormBuilder` memakai skema API yang sama (L-17), jalan tanpa JavaScript |
| `widgets.ts` · `web/widgets/` | widget dasbor terfilter izin |
| `hooks.ts` · `jobs.ts` | contoh langganan `user.created` dan job `billing.heartbeat` setiap jam |
| `seed.ts` | satu baris contoh, idempoten |
| `public.ts` · `web/public/home/` | (dengan `--public`) halaman publik `/billing`, masuk sitemap |
| `test/integration/billing.test.ts` | tes CRUD terhadap aplikasi nyata (`INTEGRATION=1`) |

Tipe field: `string` `text` `number` `boolean` `date` `select(a|b|c)`; akhiran `!` = wajib. Kolom kontrak (`id`, `client_id`, `created_at`, `updated_at`, `deleted_at`) otomatis. Tanpa `--fields` di terminal interaktif, generator bertanya.

Setelah itu:

```bash
bun run --cwd packages/db migrate   # migrasi yang baru dibuat generator (kedua dialect)
bun run db:seed                     # izin + menu + baris contoh
bun dev                             # http://127.0.0.1:5173/m/billing/invoices
INTEGRATION=1 bun test modules/Billing/test
```

Semua hasil generator adalah **kode Anda** — ubah sesuka hati; tidak ada langkah "regenerate" yang akan menimpanya.

### 2a. Peta 16 titik perluasan — masing-masing dengan contoh yang jalan (G-5)

| # | Titik perluasan | Berkas di modul | Contoh hidup | Dibuktikan oleh |
|---|---|---|---|---|
| 1 | Tabel & migrasi | `db/tables.ts` (`defineTables`, `defineTable`, `col.*`) | `modules/Example/db/tables.ts` | `bun db:generate` menulis migrasi mysql+pg; gate M0 #4 |
| 2 | Route API | `api/routes.ts` (`defineApiRoutes`) → `/v1/m/<ns>/*`, muncul di OpenAPI & Eden | `modules/Example/api/routes.ts` | tes integrasi modul; `scripts/m4-gate-proof.ts` |
| 3 | Halaman dasbor | `web/routes/**` → `/m/<ns>/*`, `export const _layoutVariant` | `modules/Example/web/routes/products/` | `scripts/m6-gate-proof.ts` (CRUD tanpa JS) |
| 4 | Menu | `menu.ts` (`defineMenu`) | `modules/Example/menu.ts` | m6 proof: entri hilang bagi user tanpa izin |
| 5 | Izin | `permissions.ts` (`definePermissions`, `CORE_ACTIONS`) | `modules/Example/permissions.ts` | m6 proof: 403 di API & halaman |
| 6 | Konfigurasi | `config.ts` (`defineConfig`) → section di `/settings`, `settings.get()` | `modules/AI/config.ts` | `scripts/m3-gate-proof.ts` |
| 7 | i18n | `i18n/<locale>.json`, kunci `<ns>.*`, `t('<ns>.x')` di halaman | `modules/Example/i18n/` | m6 proof: halaman berganti bahasa lewat `/lang` |
| 8 | Tool AI / MCP | `api/tools.ts` (`defineTools`) → ditawarkan ke asisten AI (function calling) dan `GET/POST /v1/tools`; izin + tenant ditegakkan registry core (I-3, I-6) | `modules/Example/api/tools.ts`, `modules/Dummy/api/tools.ts` | `apps/api/test/integration/tools.test.ts` (I-6), tes modul AI (loop tool stream & non-stream), m6 proof: tool tidak ditawarkan bagi user tanpa izin |
| 9 | Event hook | `hooks.ts` (`defineHooks`) — `user.created`, `user.deleted`, `tenant.switched`, `config.saved`, `module.toggled` | `modules/Dummy/hooks.ts`, hasil modgen | m6 proof: hook modgen tercatat saat admin membuat user |
| 10 | Komponen UI | `import { Button, DataTable, FormBuilder, Icon } from '@core/ui'` | `modules/Example/web/routes/**`, templat modgen | svelte-check + m6 proof |
| 11 | Widget dasbor | `widgets.ts` (`defineWidgets`) + `web/widgets/*.svelte` | `modules/Example/widgets.ts` | `scripts/m2-gate-proof.ts` (G-19), m6 proof |
| 12 | Job terjadwal | `jobs.ts` (`defineJobs`) — sekali per interval di semua instance | `modules/AI/jobs.ts` | `bun scheduler:proof` (M0 #6), m6 proof: terdaftar saat boot |
| 13 | Halaman publik | `public.ts` (`definePublicRoutes`) + `web/public/**`, sitemap | `modules/Example/public.ts` | `scripts/m4-gate-proof.ts`, m6 proof |
| 14 | Tema | `themes/<id>/` | `modules/Dummy/themes/ocean/` | `bun theme:validate`, m2 proof #5 |
| 15 | Layout | `layouts.ts` (`defineLayouts`) | `modules/Dummy/layouts.ts` | `scripts/ci/layout-contract.ts`, m2 proof #5 |
| 16 | Set ikon | `icons.ts` (`defineIconSets`) + `web/icons/<set>.ts` | `modules/Dummy/icons.ts` | `scripts/ci/icon-coverage.ts` |

### 2b. Secara manual (kalau ingin memahami tiap berkas)

Langkah yang dilakukan generator, bila Anda ingin menulis sendiri:

```bash
mkdir -p modules/Billing/db modules/Billing/api modules/Billing/web/routes/invoices
# package.json  — nama @modules/billing, dependensi workspace:* untuk tiap @core/* dan @app/api yang diimpor
# module.json   — { "name": "Billing", "version", "description": {id,en}, "engines": { "core": ">=0.0.0" } }
# tsconfig.json — { "extends": "../../tsconfig.base.json", "include": ["**/*.ts"], "exclude": ["node_modules", "web/**"] }
# modules.json  — tambahkan { "name": "Billing", "source": "local", "path": "modules/Billing" }  ← satu-satunya berkas di luar folder modul
bun install && bun modules:sync && bun db:generate && bun run --cwd packages/db migrate && bun dev
```

Nama modul **folder-case** (`Billing`, `AI`, `Example`), nama paket **huruf kecil** (`@modules/billing`). Keduanya divalidasi. Salin isi berkas dari `.bun-create/module/` (templat yang selalu sinkron dengan generator) atau dari `modules/Example/`.

---

## 3. Berkas-berkas modul dan kontraknya

Semua opsional kecuali `package.json` dan `module.json`. Sync hanya memuat yang ada.

### `module.json` — identitas

```jsonc
{
  "name": "Billing",                       // wajib sama dengan modules.json; namespace = "billing"
  "version": "0.1.0",                      // semver
  "description": { "id": "…", "en": "…" }, // opsional, minimal id+en (K-1)
  "engines": { "core": "^0.1.0" },         // rentang core yang didukung; sync menolak yang tidak cocok (G-11)
  "dependencies": ["Example"]              // modul lain yang dibutuhkan; menentukan urutan inisialisasi
}
```

Rentang `engines.core` yang didukung: `*`, eksak, `>=`, `^`, `~`, dan gabungan seperti `>=1.0.0 <2.0.0`.

### `db/tables.ts` — tabel (titik perluasan 1)

```ts
import { col, defineTable } from '@core/db/descriptor';
import { defineTables } from '@core/module-kit';

export default defineTables('Billing', [
  defineTable({
    name: 'billing_invoices',          // wajib diawali "billing_"
    tenant: true,                      // menambah client_id NOT NULL + memaksa indeks diawali client_id (B-0)
    columns: {
      number: col.identifier(32),      // ascii_bin — kode/slug/kunci
      customer: col.varchar(191),      // utf8mb4 — teks manusia
      total: col.money(),              // decimal(18,4), bukan float
      status: col.enum(['draft', 'sent', 'paid'], 16).default('draft'), // varchar + constraint aplikasi
      meta: col.json().nullable(),     // jangan pernah di-query ke dalamnya (§4.3)
      due_at: col.datetime().nullable(), // selalu UTC
    },
    indexes: [{ columns: ['client_id', 'number'], unique: true }],
  }),
]);
```

Yang Anda **tidak** tulis: `id` (UUIDv7 dari `newId()`), `status_id`, `created_at`, `updated_at`, `deleted_at` — semuanya kolom kontrak yang ditambahkan otomatis (O-4, O-5, O-6). Mendefinisikannya ulang ditolak. `softDelete: false` menghilangkan `deleted_at` untuk tabel append-only.

Tabel Anda ikut **migrasi yang sama** dengan core (`bun db:generate` → `packages/db/migrations/{mysql,pg}/`, lalu `bun db:migrate`). Modul tidak punya runner migrasi sendiri (O-1). Deskriptor yang sama menghasilkan DDL untuk MySQL 8, MariaDB 11, dan PostgreSQL 16 — Anda tidak memilih dialect.

### `permissions.ts` — izin (titik perluasan 5)

```ts
import { CORE_ACTIONS, definePermissions } from '@core/module-kit';

export default definePermissions('Billing', [
  { resource: 'billing.invoice', actions: CORE_ACTIONS, name: { id: 'Faktur', en: 'Invoices' } },
  { resource: 'billing.report',  actions: ['read', 'export'], name: { id: 'Laporan', en: 'Reports' } },
]);
```

`CORE_ACTIONS` = `read · create · edit · manage` (`manage` mencakup semuanya, C-1). Anda boleh menambah kata kerja sendiri. Resource wajib `billing.*`. Penegakan izin di API dan penyaringan menu **[menyusul di M1]** — hari ini izin baru terdaftar ke registry.

### `menu.ts` — menu (titik perluasan 4)

```ts
import { defineMenu } from '@core/module-kit';

export default defineMenu('Billing', [
  {
    id: 'billing.invoices',                 // wajib "billing.*"
    label: { id: 'Faktur', en: 'Invoices' },
    href: '/m/billing/invoices',            // wajib di bawah /m/billing
    icon: 'edit',                           // nama ikon core (packages/ui-theme/icons/registry.json) atau "billing.*"
    permission: 'billing.invoice.read',     // entri disembunyikan bila user tidak memilikinya (F-1)
    order: 100,                             // core memakai 0–99
  },
]);
```

Satu tingkat sub-menu lewat `parent: 'billing.invoices'` (F-3). Render sidebar **[menyusul di M2]**.

### `api/routes.ts` — route API (titik perluasan 2)

```ts
import { OkSchema, ok } from '@core/contracts';
import { count, eq, getDb, schema } from '@core/db';   // operator query dari @core/db, BUKAN drizzle-orm
import { defineApiRoutes } from '@core/module-kit';
import { Elysia, t } from 'elysia';

export default defineApiRoutes(
  'Billing',
  new Elysia({ name: 'module:billing', tags: ['module:billing'] })
    .get('/invoices/count', async () => {
      const [row] = await getDb().select({ n: count() }).from(schema.billingInvoices);
      return ok({ count: Number(row?.n ?? 0) });
    }, {
      response: OkSchema(t.Object({ count: t.Integer() })),
      detail: { summary: 'Jumlah faktur' },
    }),
);
```

Aturan yang berlaku:

- **Path relatif.** `/invoices/count` menjadi `/v1/m/billing/invoices/count`; sync yang me-mount, modul tidak bisa memilih atau keluar dari prefiksnya.
- **Setiap route punya skema TypeBox** (`response`, `body`, `query`) — itulah yang membuat route Anda otomatis muncul di `/openapi.json` dan bertipe di klien Eden (N-1, N-2, N-3). Route tanpa skema bukan bagian kontrak.
- **Kembalikan amplop** `ok(data)` / `ok(data, meta)`. Galat dilempar saja; hook global mengubahnya jadi `{ success: false, error, requestId }` (N-4).
- **Tabel Anda tersedia sebagai `schema.<camelCase>`** — `billing_invoices` → `schema.billingInvoices`.
- `getDb()` adalah satu-satunya koneksi (P-6). **Penjaga tenant di lapisan data [menyusul di M1]** — sampai saat itu, query Anda belum difilter `client_id` otomatis; jangan bangun fitur multi-tenant di atasnya dulu.

**Tenant dan izin di route modul (sejak M1).** Handler modul menerima `auth` (sesi) dan `tenantState` (`{ clientId, tenant, perms, can }`) dari plugin global; `tenantState.tenant` adalah fasad `forTenant()` yang menyuntikkan `client_id` ke setiap query (B-3). Jaga route dengan `beforeHandle: permission('billing.invoice.read')` dari `apps/api/src/plugins/tenancy.ts` — 401 tanpa sesi, 403 tanpa izin, superadmin lolos (C-5). Query lintas-tenant hanya lewat `unsafeAcrossTenants()` yang mudah di-grep saat audit.

### `web/routes/**` — halaman (titik perluasan 3)

Struktur folder persis SvelteKit; sync mencerminkannya ke `apps/web/src/routes/(app)/m/billing/**` sebagai *shim* tipis (Anda tidak pernah menyentuh direktori itu — ia hasil generate, di-gitignore, dan dibersihkan setiap sync). Karena berada di grup `(app)`, halaman ini **butuh sesi** dan otomatis dibungkus shell dasbor + tema aktif; halaman **publik** tanpa sesi dideklarasikan lewat `public.ts` (titik perluasan 13, di bawah).

```
modules/Billing/web/routes/
└── invoices/
    ├── +page.server.ts     # load / actions — di-re-export oleh shim
    └── +page.svelte        # komponen — dirender oleh shim dengan props yang sama
```

```ts
// +page.server.ts
import type { ServerLoad } from '@sveltejs/kit';
export const load: ServerLoad = async () => ({ title: 'Faktur' });
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  let { data } = $props();   // Svelte 5 runes
</script>
<h1>{data.title}</h1>
```

Yang berlaku hari ini: halaman ter-SSR di `/m/billing/invoices`, `+layout.svelte` dan `+error.svelte` di dalam modul juga dicerminkan.

**Sesi dan klien API (sejak M1).** `load` dan `actions` modul menerima `event` SvelteKit yang sama dengan halaman core:

```ts
// +page.server.ts
import type { ServerLoad } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

export const load: ServerLoad = async (event) => {
  const s = event.locals.session;           // null bila belum login; layout (app) sudah mengalihkan ke /auth/login
  if (!s?.can('billing.invoice.read')) return { invoices: [], denied: true };   // kosmetik (C-6b)
  const res = await apiFor(event).v1.m.billing.invoices.get();  // membawa cookie sesi + CSRF + tenant aktif
  return { invoices: res.data?.success ? res.data.data : [] };
};
```

- `event.locals.session` — `{ user, clientId, tenants, permissions, can(p) }`, diresolusi server-side sekali per request (C-7). `can()` hanya untuk menyembunyikan tombol; API tetap menolak sendiri (C-6a).
- `apiFor(event)` — klien Eden bertipe yang meneruskan cookie sesi, pasangan CSRF, origin publik, dan `X-Client-ID`. Route Anda muncul di `api.v1.m.<ns>.…` begitu `modules:sync` berjalan.
- Form: kirim `<input type="hidden" name="_csrf" value={data.csrf}>` (tersedia dari layout `(app)`) dan panggil `checkCsrf(event, form)` di awal action — persis seperti halaman core (A-10).

**[Menyusul di M2]:** layout & tema core yang membungkus halaman Anda (halaman hanya mengisi region `content`, §4.8), komponen `@core/ui`, dan `$types` untuk berkas modul — untuk sekarang pakai `ServerLoad`/`PageLoad` generik dari `@sveltejs/kit`.

### `public.ts` + `web/public/**` — halaman publik (titik perluasan 13)

Halaman tanpa sesi di luar `/m/*` — landing, katalog, detail produk. Sync mencerminkan folder ke `apps/web/src/routes/(public)/(modules)/<path>/` (layout publik tema aktif, ter-SSR, terindeks tanpa JavaScript) dan **menolak** path yang bentrok dengan halaman core atau modul lain, atau memakai awalan core (`/m`, `/auth`, `/dashboard`, …).

```ts
// public.ts
import { definePublicRoutes } from '@core/module-kit';
export default definePublicRoutes('Example', [
  { path: '/example', dir: 'web/public/landing', sitemap: true },
  { path: '/product/[slug]', dir: 'web/public/product', sitemap: false },
]);
```

Route publik konkret otomatis masuk registry route, sehingga bisa dipilih sebagai `app.landing_route` di Pengaturan (§4.7). `event.locals.config.values` (field `public`) dan `apiFor(event)` tersedia seperti halaman lain; tanpa sesi `apiFor` memanggil API secara anonim.

### `config.ts` — konfigurasi runtime (titik perluasan 6)

Section konfigurasi modul muncul otomatis di halaman **Pengaturan**; formnya di-generate dari metadata ini (E-3). Nilai tersimpan di database per tenant dengan fallback global (E-2), dan setiap penyimpanan menaikkan versi cache sehingga semua instance melihatnya tanpa restart (E-5).

```ts
// config.ts
import { defineConfig } from '@core/module-kit';
export default defineConfig('Billing', [
  { section: 'billing', title: { id: 'Penagihan', en: 'Billing' }, fields: [
    { key: 'billing.tax_rate', type: 'number', title: { id: 'Pajak (%)', en: 'Tax (%)' }, default: 11, min: 0, max: 100 },
    { key: 'billing.provider', type: 'select', title: { id: 'Penyedia', en: 'Provider' }, options: [{ value: 'xendit', label: { id: 'Xendit', en: 'Xendit' } }] },
    { key: 'billing.api_key', type: 'secret', title: { id: 'Kunci API', en: 'API key' } },
  ] },
]);
```

Tipe: `string · text · number · boolean · select · secret · markdown · route · theme · locale · list`. `route` divalidasi terhadap registry route saat disimpan; `theme` terhadap registry tema; `secret` tidak pernah dikirim ke klien dalam bentuk asli (E-4) dan disamarkan di audit log. Membaca nilai di API: `settings.get(clientId, 'billing.tax_rate')` dari `apps/api/src/services.ts`; di web: `event.locals.config.values` hanya memuat field `public`.

### `widgets.ts` — widget dasbor (titik perluasan 11)

Kartu di halaman utama dasbor. Difilter izin dan dirender **di server** seperti menu (F-1, F-2): widget yang izinnya tidak dipenuhi tidak ikut terkirim ke browser, dan komponennya tidak diunduh. Penempatan lewat metadata (`order`, `size`), bukan lewat perubahan halaman core (G-19).

```ts
// widgets.ts
import { defineWidgets } from '@core/module-kit';
export default defineWidgets('Billing', [
  { id: 'billing.outstanding', title: { id: 'Piutang', en: 'Outstanding' },
    component: 'web/widgets/Outstanding.svelte', permission: 'billing.invoice.read', order: 100, size: 'sm' },
]);
```

```svelte
<!-- web/widgets/Outstanding.svelte — komponen biasa; menerima `context` dari dasbor -->
<script lang="ts">
  let { context }: { context: { locale: string; clientId: string | null; permissions: string[] } } = $props();
</script>
<p class="text-3xl font-semibold">…</p>
```

Aturan: `component` wajib berkas `.svelte` di dalam `web/` modul (sync menolak yang tidak ada), `id` diawali namespace, `permission` hanya izin modul sendiri atau izin core. Widget **tidak mengambil data saat SSR**; angka yang butuh API diambil halaman modul sendiri (hook data widget menyusul).

### `themes/<id>/`, `layouts.ts`, `icons.ts` — tema, layout, set ikon (titik perluasan 14–16)

Modul bisa menyumbang ketiganya (§4.8, L-7, L-14). Semuanya divalidasi `modules:sync` dan `bun run theme:validate`, lalu **otomatis muncul di pemilih tema**; tidak ada berkas core yang disentuh.

```
modules/Billing/
├── themes/ocean/theme.json      # id "billing.ocean"; bentuk folder = tema core (tokens.css light+dark)
├── layouts.ts                   # defineLayouts('Billing', [{ id: 'billing.two-column', kind: 'dashboard', component: 'web/layouts/TwoColumn.svelte', … }])
├── icons.ts                     # defineIconSets('Billing', [{ id: 'billing.rounded-24', style: 'stroke', glyphs: 'web/icons/rounded-24.ts', … }])
└── web/{layouts,icons}/…
```

- **Layout** (15): komponen Svelte yang hanya menyusun region — sync menolak yang region-nya bolong dengan menyebut region mana (L-8). Begitu terdaftar, tema **mana pun** (termasuk tema core) boleh memetakan varian ke id itu.
- **Tema** (14): `theme.json` boleh merujuk layout & set ikon core maupun modul; kontras WCAG AA diperiksa sama seperti tema core (L-21). Token CSS-nya digabung ke bundel lewat berkas generate.
- **Set ikon** (16): berkas glyph mengekspor `glyphs` yang **menutup seluruh nama ikon core** — yang bolong menggagalkan sync (L-5). Modul yang memakai pustaka ikon menyatakannya sebagai dependensi sendiri (mis. `@lucide/svelte`).

Modul `AI` (`modules/AI`, lihat `docs/AI.md`) adalah bukti bahwa fitur besar — streaming, persistensi, job retensi, konfigurasi rahasia — muat dalam kontrak yang sama tanpa jalur istimewa. Modul `Example` adalah referensi kontrak lengkap (§4.6): landing publik `/example`, `/product/[slug]`, form kontak → outbox, CRUD dasbor, widget, konfigurasi, seed, i18n. Modul `Dummy` memuat tema/layout/set ikon sebagai contoh nyata: tema `dummy.ocean` memakai layout `dummy.two-column` dan set ikon `dummy.rounded-24` — bukti gate M2 #5.

### `seed.ts` — data awal idempoten (O-3)

`bun db:seed` menjalankan seed modul setelah seed core, untuk tenant `default`. Wajib idempoten — aman dijalankan setiap deploy; baris yang sudah ada (dan sudah diubah admin) tidak disentuh.

```ts
import { defineSeed } from '@core/module-kit';
export default defineSeed('Billing', async ({ db, tenantId, log }) => { /* cek dulu, insert bila belum ada */ });
```

**Sitemap dinamis.** Modul dengan halaman publik ber-parameter (mis. `/product/[slug]`) menyediakan `GET /v1/m/<ns>/sitemap` yang mengembalikan `{ path, lastmod }[]`; `sitemap.xml` core memanggilnya untuk setiap modul aktif (F-7). Route publik tanpa parameter cukup diberi `sitemap: true` di `public.ts`.

### `hooks.ts` — berlangganan event core (titik perluasan 9)

```ts
import { defineHooks } from '@core/module-kit';

export default defineHooks('Billing', {
  'user.created': async ({ userId, clientId }, ctx) => {
    // buat akun tagihan awal; ctx.requestId mengalir dari request yang memicunya
  },
  'tenant.switched': ({ userId, toClientId }) => { /* … */ },
});
```

Event yang tersedia dan payload-nya adalah **kontrak** (`CoreEventPayloads` di `@core/module-kit`): `user.created` · `user.deleted` · `tenant.switched` · `config.saved` · `module.toggled` · `system.ping`. Nama yang tidak dikenal ditolak saat definisi dan saat sync. Handler dijalankan **berurutan sesuai urutan init modul** setelah aksi inti berhasil; handler yang melempar **dicatat dan tidak menggagalkan aksi** (G-7) — jangan mengandalkan hook untuk membatalkan sesuatu.

### `jobs.ts` — pekerjaan berkala (titik perluasan 12)

```ts
import { defineJobs } from '@core/module-kit';

export default defineJobs('Billing', [
  {
    name: 'billing.remind_overdue',     // wajib "billing.*"
    every: '1h',                        // detik, atau 30s / 5m / 1h / 1d
    lease: 600,                         // opsional; baku max(5 menit, 2×every)
    description: { id: 'Pengingat tagihan lewat tempo', en: 'Overdue reminders' },
    run: async ({ instanceId, signal }) => { /* hormati signal.aborted saat shutdown */ },
  },
]);
```

Yang dijamin penjadwal core (G-18): dengan berapa pun instance API (`--scale api=3`), sebuah job berjalan **tepat sekali per interval** — lock diambil lewat satu `UPDATE` bersyarat di tabel `scheduler_jobs`, jadi jalur bakunya tidak butuh Redis (Keputusan M). Setiap eksekusi tercatat di `scheduler_runs`. Job yang melebihi `lease`-nya boleh dimulai ulang di instance lain — buat run pendek atau pecah pekerjaannya. Modul **tidak pernah** membuat timer sendiri.

### `api/tools.ts` — tool AI / MCP (titik perluasan 8)

Fungsi yang boleh dipanggil asisten AI (dan, nanti, klien MCP) atas nama user. Modul hanya **mendeklarasikan**; yang menegakkan izin, tenant, dan skema adalah registry core — jadi tool tidak pernah menjadi pintu belakang (I-3, I-6).

```ts
// api/tools.ts
import { isNull, schema } from '@core/db';
import { defineTools } from '@core/module-kit';
import { t } from 'elysia';

export default defineTools('Billing', [
  {
    name: 'billing.list_invoices',                    // wajib "billing.*"; nama kawat ke model: billing_list_invoices
    description: {                                    // untuk model — katakan KAPAN tool ini dipakai
      id: 'Daftar tagihan tenant aktif, opsional filter nomor (q).',
      en: 'List the active tenant’s invoices, optionally filtered by number (q).',
    },
    permission: 'billing.invoice.read',               // izin modul sendiri (harus ada di permissions.ts) atau izin core
    readOnly: true,                                   // petunjuk MCP readOnlyHint
    input: t.Object({ q: t.Optional(t.String({ maxLength: 120 })) }),   // TypeBox = JSON Schema: validasi + deskripsi argumen
    run: async (input, { db, userId, can, locale, signal }) => {
      const rows = await db.select(schema.billingInvoices, isNull(schema.billingInvoices.deleted_at));
      return { total: rows.length, invoices: rows.slice(0, 20) };      // apa pun yang bisa di-JSON; string diteruskan apa adanya
    },
  },
]);
```

Yang dijamin registry core pada **setiap** panggilan, dari mana pun asalnya (chat AI, `POST /v1/tools/call`, MCP nanti):

| Jaminan | Cara |
|---|---|
| Hanya terlihat & terpanggil bila user punya `permission` | registry RBAC yang sama dengan route API; tanpa izin, tool **tidak ditawarkan** ke model dan panggilan langsung ditolak `forbidden` |
| Hanya untuk tenant aktif | `ctx.db` adalah facade tenant (`forTenant(clientId)`) — tool tidak pernah menerima koneksi mentah; `X-Client-ID` mengganti tenant hanya bila user anggotanya |
| Modul nonaktif per tenant → tool ikut hilang | `module_disabled`, sama seperti route-nya (G-8) |
| Argumen sesuai skema | divalidasi TypeBox sebelum `run`; yang tidak valid dijawab ke model sebagai galat, bukan dieksekusi |
| Teraudit | setiap panggilan menulis `audit_log` (`tool.call`, resource = nama tool), sukses maupun ditolak |

Tool yang sama tersaji ke klien MCP eksternal lewat `/v1/mcp` ([`MCP.md`](./MCP.md)). Di chat AI, tool ditawarkan ke provider sebagai OpenAI `tools`; balasan `tool_calls` dijalankan lewat registry lalu dikirim balik sebagai pesan `tool`, maksimal 5 putaran per giliran; saat streaming, UI mendapat frame `dab.tool` untuk menampilkan tool yang berjalan. Admin bisa mematikannya dengan `ai.tools_enable = false`, klien per request dengan `tools: false`. Untuk API klien: `GET /v1/tools` (yang boleh dipanggil user ini) dan `POST /v1/tools/call { name, input }`.

Aturan: `name` diawali namespace dan ≤ 64 karakter dalam bentuk kawat (`<ns>_<nama>`); `permission` milik modul sendiri harus dideklarasikan di `permissions.ts` (sync menolak yang tidak ada); `input` harus skema objek. Modul **tidak boleh** memanggil tool modul lain lewat internal — pakai `POST /v1/tools/call` atau tunggu MCP.

---

## 4. Apa yang diperiksa `bun modules:sync`

Semua masalah dilaporkan **sekaligus**, dengan nama modulnya. Contoh pesan nyata:

| Pelanggaran | Pesan |
|---|---|
| Nama tabel tanpa prefiks | `modul Billing (modules/Billing): tabel "invoices" harus diawali "billing_" (G-9)` |
| Izin milik orang lain | `… resource izin "user.read" harus diawali "billing." (G-9)` |
| Menu keluar namespace | `… href menu "billing.x" harus di bawah /m/billing (G-9)` |
| Ikon tak dikenal | `… ikon "foo" pada menu "billing.x" bukan nama core dan bukan "billing.*" (L-5)` |
| Core terlalu tua/baru | `… butuh core ^2.0.0, terpasang 0.0.0 (G-11)` |
| Bentrok antar-modul | `tabel "billing_invoices" didefinisikan oleh Billing dan Legacy` |
| `api/routes.ts` bukan Elysia | `… api/routes.ts harus meng-export default instance Elysia (pakai defineApiRoutes)` |
| Event tak dikenal / job tanpa prefiks / interval < 1 s | `… hooks.ts berlangganan event "invoice.paid" yang tidak dikenal core` · `… job "cleanup" harus diawali "billing." (G-9)` · `… job "billing.fast": interval 0s harus bilangan bulat ≥ 1 detik` |
| Tool tanpa prefiks / izin tak dideklarasikan / skema bukan objek | `… nama tool "other.thing" harus diawali "billing." (G-9)` · `… tool "billing.ghost" menuntut izin "billing.nothing.read" yang tidak ada di permissions.ts` · `… tool "billing.bare": input harus JSON Schema bertipe object` |
| Dependensi tak dideklarasikan | `… api/routes.ts gagal dimuat — Cannot find package 'x'` |

Sync juga menolak menghapus `apps/web/src/routes/(app)/m/` atau `(public)/(modules)/` bila direktori itu ada tanpa penanda hasil generate — supaya tidak pernah menghapus pekerjaan tangan siapa pun.

---

## 5. Perintah yang perlu Anda tahu

| Perintah | Kapan |
|---|---|
| `bun modgen <Nama> --fields …` | Membuat modul lengkap + daftar + sync + migrasi (§2). `--dry-run` untuk melihat daftar berkas, `--no-register` untuk berkas saja |
| `bun create module <folder>` | Repositori modul standalone dari templat `.bun-create/module` (§7) |
| `bun modules:add <git-url> --ref <tag>` | Memasang modul dari repositori lain sebagai submodule terkunci (§7) |
| `bun modules:sync` | Setelah menambah/mengubah/mencabut modul. Otomatis sebelum `dev`, `build`, `check`, `test` |
| `bun db:generate` | Setelah mengubah `db/tables.ts` — menulis migrasi baru untuk kedua dialect |
| `bun db:migrate` | Menerapkan migrasi ke database dari `DATABASE_URL`. Satu-satunya jalur produksi (Q-4) |
| `bun check` | Lint + typecheck semua paket, termasuk modul Anda (dua dialect untuk db) |
| `bun test` | Semua test workspace — taruh test modul di `modules/<Nama>/test/*.test.ts` |
| `bun run db:matrix:docker` | Migrasi + smoke di MySQL 8, MariaDB 11, PostgreSQL 16 sekaligus |

Mencabut modul: hapus entrinya dari `modules.json`, jalankan `bun modules:sync` — route API, halaman, menu, dan izinnya hilang; **tabelnya tetap ada** (G-8; uninstall bersih dengan migrasi turun **[menyusul, G-15]**).

---

## 6. Yang belum ada — jangan diasumsikan

Semua 16 titik perluasan di §2a **tersedia**. Yang belum ada:

| Hal | Status |
|---|---|
| Modul sebagai paket npm (`source: "package"`) | M7. Hari ini: `local` atau `submodule` |
| UI admin modul (G-14) — daftar modul, sumber & versi, aktif/nonaktif per tenant, galat muat | Sebagian: `/modules` menampilkan modul dan status per tenant; sumber/versi/galat muat menyusul M7 |
| Uninstall bersih dengan migrasi turun (G-15) | M7. Mencabut modul hari ini meninggalkan tabelnya (G-8) |
| Playwright E2E untuk halaman modul (P-8) | M7. Bukti hari ini lewat HTTP tanpa browser (`scripts/m6-gate-proof.ts`) |

---

## 7. Modul di repositori sendiri

Tim lain boleh mengembangkan modul di repositorinya sendiri dengan siklus rilisnya sendiri (PRD §4.9). Struktur foldernya **sama persis** dengan modul lokal — hanya lokasinya yang berbeda.

### 7a. Memulai repositori modul — `bun create module`

```bash
# dari checkout core mana pun (templat ada di .bun-create/module; Bun membacanya otomatis)
bun create module ../mod-billing
cd ../mod-billing
bun run rename Billing        # sekali: Hello → Billing (namespace, tabel, izin, route, tes)
bun run harness               # clone core ke .core/ pada ref di package.json → "core", tautkan modul, sync, tsc, lint, migrasi, tes
```

Di luar checkout core: `BUN_CREATE_DIR=<checkout>/.bun-create bun create module ../mod-billing`, atau salin folder `.bun-create/module`. Templat ini **dibangun dari generator yang sama** dengan `bun modgen` (`bun run starter:build`; CI menolak bila keduanya berbeda), jadi modul standalone dan modul lokal identik isinya.

Yang ada di repo modul selain kode modul itu sendiri:

| Berkas | Guna |
|---|---|
| `harness.ts` | **Satu-satunya cara build/lint/test tanpa meng-clone core secara manual** (§4.9 poin 2). Menyalin modul ke `<core>/modules/<Nama>`, mendaftarkannya, `bun install`, `modules:sync`, `tsc`, `biome check`, `db:generate`, lalu `bun test modules/<Nama>/test`. Dengan `DATABASE_URL`: migrasi + tes integrasi. `--web`: + svelte-check halaman |
| `rename.ts` | Mengganti nama modul di semua berkas & nama berkas |
| `.github/workflows/ci.yml` | CI repo modul: MySQL service + `bun run harness --web` |
| `package.json` → `"core": { "repo", "ref" }` | Core yang dipakai harness. Ganti `ref` ke tag core saat merilis, selaras dengan `engines.core` di `module.json` |

Siklus dev di browser: arahkan harness ke checkout core yang sudah ada — modul ditautkan ke sana dan `bun dev` di core menyajikannya.

```bash
CORE_DIR=../dashboard-ai-boilerplate-ssr bun run harness   # lalu di core: bun dev → /m/billing/…
```

`tsconfig.json` modul mengacu `../../tsconfig.base.json` dan dependensinya `workspace:*` — keduanya **benar saat modul berada di dalam core** (yang selalu terjadi lewat harness atau `modules:add`). Karena itu `bun install` langsung di repo modul tidak berguna; pakai harness.

### 7b. Memasang di host — `bun modules:add`

```bash
# di repo modul: rilis
git tag v1.4.2 && git push --tags
# di host: pasang dari git, terkunci pada tag/commit — branch ditolak (Keputusan L)
bun modules:add git@github.com:tim/mod-billing.git --ref v1.4.2
bun db:generate && bun run --cwd packages/db migrate
git add modules.json .gitmodules biome.json bun.lock packages/db/migrations modules/Billing && git commit -m "modul Billing v1.4.2"
```

Yang dilakukan perintah itu: `git submodule add` ke `modules/<Nama>` (nama dibaca dari `module.json` repo), `git checkout --detach <ref>`, entri `{ "source": "submodule", "repo", "ref", "path" }` ke `modules.json`, pengecualian path itu dari Biome host, `bun install`, lalu `modules:sync`.

Aturan yang dijaga `modules:sync` untuk sumber `submodule`:

- **Ref terkunci diverifikasi setiap sync.** HEAD submodule harus sama dengan `ref` di `modules.json`; kalau bergeser, sync gagal dan menyebut kedua commit. Menaikkan versi = ubah `ref` di `modules.json`, `git -C modules/<Nama> checkout <ref>`, sync.
- **Submodule kosong di-init otomatis** (`git submodule update --init`) — clone baru tinggal `bun install && bun modules:sync`. CI men-checkout dengan `submodules: true`.
- **Modifikasi lokal di folder submodule hanya diperingatkan**, bukan ditolak — tapi jangan: ubah di repo asalnya, rilis tag baru, naikkan `ref`.
- Host **tidak** me-lint/memformat kode modul eksternal; modul itu tanggung jawab reponya sendiri — CI di repo modul (`harness --web`) yang melakukannya.

Seluruh alur ini dibuktikan otomatis di CI oleh `bun run ci:cross-repo` (`scripts/ci/cross-repo-proof.sh`): `bun create module` → rename → harness terhadap clone core → `modules:add` dari URL git pada tag → hanya `modules.json`, `.gitmodules`, `biome.json`, `bun.lock`, `modules/<Nama>` dan migrasi yang berubah → uninstall → pohon identik.

---

## 8. Penjaga CI "tanpa ubah core" (G-6)

Janji modularitas diukur, bukan dipercaya. Dua penjaga berjalan di setiap push:

| Penjaga | Perintah | Yang dibuktikan |
|---|---|---|
| modgen | `bun run ci:modgen-guard` | `bun modgen CiProbe …` lalu `git status` hanya menyentuh `modules/CiProbe/`, `modules.json`, `bun.lock`, `packages/db/migrations/**`; tool modul masuk registry generate; migrasinya hanya `CREATE TABLE`; modul dihapus + sync → pohon identik HEAD dan tidak ada jejak `ciprobe` di output generate (gate M6 #4) |
| lintas repo | `bun run ci:cross-repo` | seperti di §7b |

Ditambah `bun run ci:sync-pure` (sync modul yang sudah tercatat adalah no-op) dan `bun run proof:m5:gate4` (tanpa modul AI, aplikasi ter-build tanpa jejak AI).

Kalau Anda menemukan kebutuhan modul yang **memaksa** mengubah core, yang benar adalah **mempercepat kontraknya** (ajukan titik perluasan baru di `packages/module-kit`), bukan mengimpor internal core dari modul. Impor internal akan pecah pada rilis berikutnya dan tidak akan lolos review.
