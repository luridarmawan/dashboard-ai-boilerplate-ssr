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

Yang berlaku hari ini: halaman ter-SSR di `/m/billing/invoices`, `+layout.svelte` dan `+error.svelte` di dalam modul juga dicerminkan. **[Menyusul di M1/M2]:** klien API bertipe untuk `load` modul, layout & tema core yang membungkus halaman Anda (halaman hanya mengisi region `content`, §4.8), komponen `@core/ui`, dan `$types` untuk berkas modul — untuk sekarang pakai `ServerLoad`/`PageLoad` generik dari `@sveltejs/kit`.

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
| 1 tabel · 2 route API · 3 halaman · 4 menu · 5 izin | **Tersedia (M0)** — dokumen ini |
| Penegakan izin & penjaga tenant di data layer | M1 (B-3, C-6) |
| 6 konfigurasi · 7 i18n · layout/tema membungkus halaman modul · `@core/ui` | M2–M3 |
| 9 event hook · 12 job terjadwal | M0 akhir (G-17, G-18) — kontraknya sedang ditulis |
| 8 tool AI/MCP · 11 widget dashboard | M2/M5 |
| 13 halaman publik · 14 tema · 15 layout · 16 set ikon | M2/M4 |
| Modul dari **repositori git terpisah** (`bun modules:add <url>`, `source: "submodule"`) | M0 gate 5 — berikutnya |
| Modul sebagai paket npm (`source: "package"`) | M6 |
| `bun modgen` (generator CRUD) · starter repo modul | M6 |

Kalau Anda membutuhkan salah satu di atas sekarang, yang benar adalah **mempercepat kontraknya**, bukan mengimpor internal core dari modul. Impor internal akan pecah pada rilis berikutnya dan tidak akan lolos review.
