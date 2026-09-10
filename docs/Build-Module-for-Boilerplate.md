# Membangun Modul di Dalam Repo Ini

Tutorial berurutan: dari repo bersih sampai sebuah modul jalan di dashboard, lengkap dengan tabel, izin, menu, CRUD, dan tesnya. Targetnya **modul yang menjadi bagian dari produk ini sendiri** — kodenya tinggal di `modules/<Nama>` pada repo ini dan ikut siklus rilisnya.

Kalau modul Anda milik tim lain, punya siklus rilis sendiri, atau akan dipasang ke beberapa instalasi, pakai [`Build-Module-for-Your-Apps.md`](./Build-Module-for-Your-Apps.md) — modul di repositori sendiri, dipasang sebagai submodule terkunci.

Referensi kontraknya (setiap berkas modul, 16 titik perluasan, aturan yang dijaga `modules:sync`) ada di [`MODULES.md`](./MODULES.md). Dokumen ini alurnya; dokumen itu spesifikasinya.

## 0. Prasyarat

```bash
bun install
cp .env.example .env          # DATABASE_URL, DB_DIALECT
bun run --cwd packages/db migrate
bun run db:seed               # BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD dari .env
bun dev                       # api + web; port dicetak di terminal
```

Kalau `bun dev` sudah menampilkan halaman masuk dan Anda bisa login, prasyaratnya beres.

## 1. Satu perintah: `bun modgen`

```bash
bun modgen Billing --resource invoice --fields "title:string!,amount:number,paid:boolean"
```

- `Billing` → namespace `billing`, tabel `billing_*`, route `/m/billing/…`, izin berawalan `billing.`
- `--resource invoice` → CRUD untuk satu sumber daya, halamannya `/m/billing/invoices`
- `--fields` → `nama:tipe`, akhiran `!` berarti wajib. Tipe: `string text number boolean date select(a|b)`
- `--public` → sekalian halaman publik di `/billing` (titik perluasan 13)
- `--dry-run` → cetak daftar berkasnya saja, tidak menulis apa pun. Jalankan ini dulu kalau ragu.

Tanpa `--fields` dan di terminal interaktif, generator akan bertanya.

Yang dihasilkan — 26 berkas, semuanya di dalam `modules/Billing/`:

```
module.json  package.json  tsconfig.json      ← identitas & dependensi modul
db/tables.ts                                  ← tabel (netral dialect)
permissions.ts  menu.ts  config.ts            ← izin, entri menu, setelan modul
i18n/id.json  i18n/en.json                    ← terjemahan (tidak ada string keras di komponen)
api/schemas.ts  api/routes.ts  api/tools.ts   ← skema TypeBox bersama, endpoint, tool MCP
hooks.ts  jobs.ts  widgets.ts  seed.ts        ← event hook, job terjadwal, widget dashboard, seed
web/routes/invoices/…                         ← daftar, tambah, ubah (7 berkas, tanpa JS)
web/widgets/Summary.svelte                    ← widget dashboard
test/integration/billing.test.ts              ← tes integrasi yang sudah jalan
README.md
```

**Di luar folder modul, satu-satunya berkas core yang berubah adalah `modules.json`** (plus registry ter-generate, `bun.lock`, dan berkas migrasi baru). Itu bukan kebetulan — penjaga CI `ci:modgen-guard` menolak perubahan yang menyentuh berkas core lain (G-6). Kalau suatu saat Anda merasa "modul ini perlu mengubah satu baris di core", itu sinyal titik perluasannya kurang, bukan izin untuk menambal core.

`modgen` sudah menjalankan `bun install`, `modules:sync`, dan `db:generate` untuk Anda.

## 2. Terapkan migrasinya, lalu lihat

```bash
bun run --cwd packages/db migrate
bun dev
```

Login, dan menu **Billing** muncul dengan halaman daftar di `/m/billing/invoices`. Tambah satu baris — CRUD-nya sudah jalan, tanpa JavaScript sekalipun.

Kalau menunya tidak muncul, berarti soal izin (§3), bukan soal kode.

## 3. Izin dan aktivasi per tenant

Modul mendeklarasikan izinnya sendiri di `permissions.ts`. Polanya `<namespace>.<resource>.<aksi>` — untuk contoh di atas: `billing.invoice.read`, `.create`, `.edit`, `.manage`. Dua hal yang menentukan apakah seseorang melihat menunya:

1. **Izin.** Superadmin punya `*.*` dan langsung melihatnya. Pengguna lain perlu grup yang diberi izin itu — atur di **Grup → pilih grup → matriks izin**; wildcard seperti `billing.invoice.*` juga diterima.
2. **Modul aktif untuk tenant itu** (G-8). Halaman **Modul** (izin `module.manage`) menyalakan/mematikan modul per tenant. Modul yang dimatikan hilang dari menu, route-nya menolak, dan widget-nya tidak dirender.

## 4. Lingkaran kerja: menambah kolom

Ini pola yang akan Anda ulang terus:

```bash
# 1. ubah modules/Billing/db/tables.ts — tambah kolom
# 2. buat migrasinya (bootstrap + drizzle-kit)
bun run db:generate
# 3. terapkan
bun run --cwd packages/db migrate
```

Lalu ikutkan kolom itu di `api/schemas.ts` (skema TypeBox yang dipakai API **dan** form web), di `web/routes/invoices/_form.ts`, dan tambahkan kuncinya di `i18n/id.json` + `i18n/en.json`.

**Jaga nama tabel tetap pendek.** MySQL membatasi nama constraint 64 karakter, dan nama foreign key dibentuk dari `TABLE_PREFIX` + nama tabel + nama kolom. `billing_invoice_items` masih aman; nama yang berlapis-lapis akan meledak justru saat seseorang memasang dengan prefiks tabel.

## 5. Titik perluasan yang sudah terisi contoh

`modgen` tidak hanya membuat CRUD — ia mengisi contoh yang jalan untuk titik perluasan yang paling sering dipakai. Buka berkasnya, ganti isinya:

| Berkas | Isinya |
|---|---|
| `hooks.ts` | Berlangganan event core (mis. `user.created`) — event bus, bukan impor silang antar modul |
| `jobs.ts` | Job terjadwal; core menjamin **berjalan tepat sekali** walau instance-nya tiga |
| `widgets.ts` + `web/widgets/*.svelte` | Widget dashboard; boleh menyebut path `data` agar dashboard mengambilkan datanya |
| `api/tools.ts` | Tool yang otomatis terpapar ke MCP dan ke chat AI |
| `config.ts` | Setelan modul yang muncul sebagai form di **Pengaturan** |
| `seed.ts` | Data awal, idempoten |

Daftar lengkap 16 titik perluasan beserta kontraknya ada di [`MODULES.md` §3](./MODULES.md).

## 6. Tes, lint, typecheck

```bash
bun run test:unit                                   # unit, tanpa DB
INTEGRATION=1 bun test modules/Billing/test         # integrasi (butuh DATABASE_URL)
bun run lint && bun run typecheck
```

Aturan review yang berlaku untuk modul (ROADMAP §7): endpoint baru punya skema TypeBox sehingga OpenAPI ikut benar; tidak ada string keras di komponen; tidak ada warna literal; kueri ke tabel ber-tenant lewat helper repository, bukan kueri langsung; dan bila perilaku yang tertulis di PRD berubah, PRD ikut diperbarui pada PR yang sama.

## 7. Mencabut modul

```bash
bun modules:remove Billing            # --dry-run dulu kalau mau melihat rencananya
```

Perintah ini melepas entri `modules.json`, menghapus foldernya, menjalankan `bun install` + `bootstrap`, lalu **mengurus database**: bila tabel modul sudah pernah dirilis, ia menulis migrasi turun (DROP anak→induk, aman-FK) plus pembersihan baris core yang ditinggalkan modul; bila migrasinya belum pernah di-commit, berkas migrasi itu dikembalikan ke HEAD. Terapkan dengan `db:migrate` **setelah backup**.

## 8. Daftar periksa sebelum PR

- [ ] `bun run check` hijau (bootstrap + lint + typecheck)
- [ ] Tes modul lewat, unit maupun integrasi
- [ ] Diff-nya hanya menyentuh `modules/<Nama>/**`, `modules.json`, `bun.lock`, registry ter-generate, dan `packages/db/migrations/**`
- [ ] Tidak ada string keras di komponen; kunci i18n lengkap di `id` dan `en`
- [ ] Modul dimatikan per tenant → halaman lain tetap benar (G-8)
- [ ] `bun modules:remove <Nama>` dijalankan sekali di cabang percobaan — pohon kembali bersih
