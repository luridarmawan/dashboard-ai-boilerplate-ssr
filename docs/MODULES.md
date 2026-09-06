# Membangun Modul Pertama Anda

| | |
|---|---|
| **Status** | Versi 1 — kontrak M0. Bagian yang belum tersedia ditandai **[menyusul di M*]** dan tidak boleh diasumsikan |
| **Kontrak lengkap** | [`PRD.md` §4.5](./PRD.md) (16 titik perluasan), §4.9 (modul lintas repositori), FR-G |
| **Contoh hidup** | [`modules/Dummy/`](../modules/Dummy) — modul kecil yang dipakai gate M0; salin dari sana |

Dokumen ini adalah tempat yang perlu Anda baca untuk membuat modul. Kalau ada langkah yang ternyata membutuhkan perubahan pada berkas di luar `modules/` dan `modules.json`, itu **cacat pada kontrak modul** (PRD §3 prinsip 6) — laporkan, jangan tambal core.

---

## 1. Tiga aturan yang tidak bisa ditawar

1. **Modul adalah paket nyata.** Ia punya `package.json` sendiri dan mengimpor core lewat nama paket — `@core/db`, `@core/module-kit`, `@core/contracts` — bukan path relatif ke `packages/`. Karena itu ia bisa dipindah folder, atau dipindah ke repositori lain, tanpa rusak. Konsekuensinya keras: **apa pun yang Anda impor harus Anda deklarasikan** sebagai dependensi; kalau tidak, `modules:sync` gagal dengan `Cannot find package`.
2. **Semua yang Anda sumbangkan memakai namespace Anda.** Untuk modul bernama `Billing`, namespace-nya `billing`: tabel `billing_*`, izin `billing.*`, id menu `billing.*`, route API otomatis di `/v1/m/billing/*`, halaman di `/m/billing/*`. Ini ditegakkan `modules:sync`, bukan disepakati — pelanggaran menggagalkan sync dengan pesan yang menyebut modul Anda, dan bentrokan menyebut kedua modul.
3. **Core tidak tahu nama modul Anda.** Tidak ada `import` ke modul di mana pun di core; core hanya mengimpor berkas hasil `modules:sync`. Menambah atau mencabut modul = mengubah `modules.json` + menjalankan sync. Titik.

---

## 2. Dari nol sampai jalan — 10 menit

```bash
# 1. Buat folder & paket
mkdir -p modules/Billing/db modules/Billing/api modules/Billing/web/routes/invoices

cat > modules/Billing/package.json <<'EOF'
{
  "name": "@modules/billing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@core/contracts": "workspace:*",
    "@core/db": "workspace:*",
    "@core/module-kit": "workspace:*",
    "elysia": "^1.4.0"
  },
  "devDependencies": { "@sveltejs/kit": "^2.70.0", "svelte": "^5.40.0" }
}
EOF

cat > modules/Billing/module.json <<'EOF'
{
  "name": "Billing",
  "version": "0.1.0",
  "description": { "id": "Penagihan", "en": "Billing" },
  "engines": { "core": ">=0.0.0" }
}
EOF

cat > modules/Billing/tsconfig.json <<'EOF'
{ "extends": "../../tsconfig.base.json", "include": ["**/*.ts"] }
EOF

# 2. Daftarkan sumbernya — satu-satunya berkas di luar folder modul yang Anda sentuh
#    (tambahkan objek ini ke array "modules" di modules.json)
#    { "name": "Billing", "source": "local", "path": "modules/Billing" }

# 3. Pasang dependensi, rakit, buat migrasi, jalankan
bun install
bun modules:sync          # validasi + generate registry
bun db:generate           # migrasi baru untuk tabel Anda (kedua dialect)
bun db:migrate            # terapkan ke database dev
bun dev                   # http://127.0.0.1:5173/m/billing/invoices
```

Nama modul **folder-case** (`Billing`, `AI`, `Example`), nama paket **huruf kecil** (`@modules/billing`). Keduanya divalidasi.

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

Struktur folder persis SvelteKit; sync mencerminkannya ke `apps/web/src/routes/m/billing/**` sebagai *shim* tipis (Anda tidak pernah menyentuh direktori itu — ia hasil generate, di-gitignore, dan dibersihkan setiap sync).

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

Modul `Dummy` memuat ketiganya sebagai contoh nyata: tema `dummy.ocean` memakai layout `dummy.two-column` dan set ikon `dummy.rounded-24` — bukti gate M2 #5.

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
| Dependensi tak dideklarasikan | `… api/routes.ts gagal dimuat — Cannot find package 'x'` |

Sync juga menolak menghapus `apps/web/src/routes/m/` bila direktori itu ada tanpa penanda hasil generate — supaya tidak pernah menghapus pekerjaan tangan siapa pun.

---

## 5. Perintah yang perlu Anda tahu

| Perintah | Kapan |
|---|---|
| `bun modules:sync` | Setelah menambah/mengubah/mencabut modul. Otomatis sebelum `dev`, `build`, `check`, `test` |
| `bun db:generate` | Setelah mengubah `db/tables.ts` — menulis migrasi baru untuk kedua dialect |
| `bun db:migrate` | Menerapkan migrasi ke database dari `DATABASE_URL`. Satu-satunya jalur produksi (Q-4) |
| `bun check` | Lint + typecheck semua paket, termasuk modul Anda (dua dialect untuk db) |
| `bun test` | Semua test workspace — taruh test modul di `modules/<Nama>/test/*.test.ts` |
| `bun run db:matrix:docker` | Migrasi + smoke di MySQL 8, MariaDB 11, PostgreSQL 16 sekaligus |

Mencabut modul: hapus entrinya dari `modules.json`, jalankan `bun modules:sync` — route API, halaman, menu, dan izinnya hilang; **tabelnya tetap ada** (G-8; uninstall bersih dengan migrasi turun **[menyusul, G-15]**).

---

## 6. Yang belum ada — jangan diasumsikan

| Titik perluasan | Status |
|---|---|
| 1 tabel · 2 route API · 3 halaman · 4 menu · 5 izin · 9 event hook · 12 job terjadwal | **Tersedia (M0)** — dokumen ini |
| Penegakan izin (`permission()` / `requirePermission()` di API, `locals.session.can()` di web) & penjaga tenant di data layer (`forTenant`, B-3) | **Tersedia (M1)** — lihat §3 halaman dan route API |
| 6 konfigurasi · 7 i18n · layout/tema membungkus halaman modul · `@core/ui` | M2–M3 |
| 11 widget dashboard (`widgets.ts`, terfilter izin, SSR) | **Tersedia (M2)** |
| 8 tool AI/MCP | M5 |
| 14 tema · 15 layout · 16 set ikon (`themes/`, `layouts.ts`, `icons.ts`) | **Tersedia (M2)** |
| 13 halaman publik | M4 |
| Modul dari **repositori git terpisah** (`bun modules:add <url> --ref <tag>`, `source: "submodule"`) | **Tersedia (M0)** — lihat §7 |
| Modul sebagai paket npm (`source: "package"`) | M6 |
| `bun modgen` (generator CRUD) · starter repo modul | M6 |

---

## 7. Modul di repositori sendiri

Tim lain boleh mengembangkan modul di repositorinya sendiri dengan siklus rilisnya sendiri (PRD §4.9). Struktur foldernya **sama persis** dengan modul lokal — hanya lokasinya yang berbeda.

```bash
# di host: pasang dari git, terkunci pada tag/commit — branch ditolak (Keputusan L)
bun modules:add git@github.com:tim/mod-billing.git --ref v1.4.2
git add modules.json .gitmodules biome.json modules/Billing && git commit -m "modul Billing v1.4.2"
```

Yang dilakukan perintah itu: `git submodule add` ke `modules/<Nama>` (nama dibaca dari `module.json` repo), `git checkout --detach <ref>`, entri `{ "source": "submodule", "repo", "ref", "path" }` ke `modules.json`, pengecualian path itu dari Biome host, `bun install`, lalu `modules:sync`.

Aturan yang dijaga `modules:sync` untuk sumber `submodule`:

- **Ref terkunci diverifikasi setiap sync.** HEAD submodule harus sama dengan `ref` di `modules.json`; kalau bergeser, sync gagal dan menyebut kedua commit. Menaikkan versi = ubah `ref` di `modules.json`, `git -C modules/<Nama> checkout <ref>`, sync.
- **Submodule kosong di-init otomatis** (`git submodule update --init`) — clone baru tinggal `bun install && bun modules:sync`. CI men-checkout dengan `submodules: true`.
- **Modifikasi lokal di folder submodule hanya diperingatkan**, bukan ditolak — tapi jangan: ubah di repo asalnya, rilis tag baru, naikkan `ref`.
- Host **tidak** me-lint/memformat kode modul eksternal; modul itu tanggung jawab reponya sendiri (§4.9 poin 2). Starter repo dengan konfigurasi build/lint/test mandiri **[menyusul di M6, G-12]**.

`tsconfig.json` modul mengacu `../../tsconfig.base.json` — benar saat terpasang di host. Typecheck mandiri di repo modul sendiri menunggu starter M6.

Kalau Anda membutuhkan salah satu di atas sekarang, yang benar adalah **mempercepat kontraknya**, bukan mengimpor internal core dari modul. Impor internal akan pecah pada rilis berikutnya dan tidak akan lolos review.
