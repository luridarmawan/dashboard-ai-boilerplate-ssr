# Membangun Modul di Repositori Anda Sendiri

Tutorial untuk membangun modul yang **hidup di repo Anda sendiri**, punya siklus rilis sendiri, lalu dipasang ke satu atau banyak instalasi dasbor ini. Termasuk kasus repo privat — modulnya privat, core-nya privat, atau keduanya.

Kalau modulnya justru bagian dari produk ini dan tinggal di dalam repo ini, pakai [`Build-Module-for-Boilerplate.md`](./Build-Module-for-Boilerplate.md).

## Model mentalnya dulu — supaya tidak salah jalan

Tiga hal yang sering ditebak salah:

- **Jangan fork core.** Yang di-fork akan berhenti bisa diperbarui, dan justru itu yang harus tetap mengalir. Kontraknya kebalikan dari fork: modul **tidak menyentuh berkas core sama sekali**, dan itu dijaga penjaga CI (G-6).
- **Repo modul Anda berdiri sendiri.** Ia bukan turunan core dan tidak menyalin core.
- **Submodule adalah cara HOST memasang, bukan cara Anda bekerja.** Anda mengembangkan di repo biasa; saat dipasang, host menaruhnya sebagai submodule terkunci pada tag.

Selama pengembangan, core dipakai sebagai "SDK": `harness.ts` meng-clone core ke `.core/`, menyalin modul Anda ke `<core>/modules/<Nama>`, lalu menjalankan install, sync, typecheck, lint, migrasi, dan tes **di sana**. Core-nya sekali pakai; modul Anda tetap satu-satunya yang Anda commit.

```
repo-modul-anda/            core (clone sekali pakai di .core/, atau CORE_DIR)
├── module.json             modules/Billing/   ← modul Anda disalin ke sini oleh harness
├── db/tables.ts     ──────▶ install → sync → tsc → biome → db:generate → test
├── api/  web/  test/
└── harness.ts
```

## 0. Prasyarat

Bun 1.4.x, akses baca ke repo core, dan MySQL/PostgreSQL bila Anda mau menjalankan tes integrasi. Core ini berlisensi MIT — bila repositorinya publik, tidak ada kredensial yang perlu disiapkan; untuk core privat (fork atau mirror internal) lihat §7a.

Lisensi modul Anda sendiri terserah Anda: templat modul tidak menuliskan field `license`, dan modul yang hanya bergantung pada `@core/*` lewat kontrak modul tidak terikat lisensi core.

## 1. Bikin repo modulnya

```bash
# dari checkout core mana pun — templatnya ada di .bun-create/module
bun create module ../mod-billing
cd ../mod-billing
bun run rename Billing        # sekali saja: Hello → Billing (namespace, tabel, izin, route, tes)
git init && git add -A && git commit -m "modul Billing dari templat"
```

Di luar checkout core: `BUN_CREATE_DIR=<core>/.bun-create bun create module ../mod-billing`, atau salin folder `.bun-create/module` sekali dan pakai berulang.

Templat ini dibangun dari generator yang sama dengan `bun modgen` (CI core menolak bila keduanya berbeda), jadi isi modul standalone dan modul lokal identik — termasuk contoh hook, job, widget, tool, dan tes integrasi yang sudah jalan.

## 2. Build, lint, test — tanpa menyiapkan core secara manual

```bash
bun run harness                                     # clone core ke .core/ pada ref di package.json
bun run harness --web                               # + svelte-check untuk halaman modul
DATABASE_URL=mysql://app:app@127.0.0.1:3306/app bun run harness   # + migrasi & tes integrasi
```

**`bun install` langsung di repo modul tidak berguna** — dependensinya `workspace:*` dan `tsconfig.json`-nya mengacu `../../tsconfig.base.json`; keduanya baru benar ketika modul berada di dalam core. Itulah alasan harness ada. Kalau Anda melihat galat resolusi paket, hampir pasti karena melewatkan harness.

Core mana yang dipakai diatur di `package.json` repo modul:

```jsonc
"core": { "repo": "https://github.com/<owner>/<core>.git", "ref": "main" }
```

Bisa ditimpa lewat env: `CORE_REPO`, `CORE_REF`, atau `CORE_DIR`.

## 3. Lingkaran kerja di browser

Untuk melihat halaman modul sungguhan, arahkan harness ke checkout core yang sudah ada, lalu jalankan `bun dev` di core itu:

```bash
CORE_DIR=../dashboard-ai-boilerplate-ssr bun run harness
cd ../dashboard-ai-boilerplate-ssr && bun dev        # modul tersaji di /m/billing/…
```

Ulangi `harness` setiap kali Anda ingin menyalin perubahan modul ke core. Yang Anda commit tetap hanya repo modul.

## 4. CI repo modul

Templat sudah membawa `.github/workflows/ci.yml`: MySQL sebagai service, lalu satu langkah `bun run harness --web`. Itu memberi Anda typecheck, lint, migrasi, dan tes integrasi modul di setiap push — tanpa perlu core checkout buatan tangan.

## 5. Merilis

```bash
# 1. selaraskan versi core yang Anda dukung
#    module.json  → "engines": { "core": ">=1.2.0" }
#    package.json → "core": { "ref": "v1.2.0" }   (harness & CI ikut ref ini)
# 2. tag
git tag v1.4.2 && git push --tags
```

`engines.core` bukan hiasan: host memeriksanya (G-11), dan katalog menandai modul yang tidak cocok sebagai *tidak cocok* tanpa memberi perintah pasang.

## 6. Memasang di host

```bash
bun modules:add git@github.com:tim/mod-billing.git --ref v1.4.2
bun db:generate && bun run --cwd packages/db migrate
git add modules.json .gitmodules biome.json bun.lock packages/db/migrations modules/Billing
git commit -m "modul Billing v1.4.2"
```

Yang terjadi: `git submodule add` ke `modules/Billing`, checkout detach pada ref, entri `{ "source": "submodule", "repo", "ref", "path" }` di `modules.json`, path itu dikecualikan dari Biome host (modul eksternal di-lint di repo asalnya), `bun install`, lalu `modules:sync`.

**Ref wajib tag atau commit — branch ditolak**, supaya sebuah build bisa direproduksi dari `modules.json` saja.

Menaikkan versi:

```bash
git -C modules/Billing fetch --tags && git -C modules/Billing checkout v1.5.0
# ubah "ref" di modules.json menjadi v1.5.0
bun run modules:sync && bun db:generate && bun run --cwd packages/db migrate
```

`modules:sync` memverifikasi HEAD submodule sama dengan `ref` di `modules.json` setiap kali; kalau bergeser, sync gagal dan menyebut kedua commit. Mencabut: `bun modules:remove Billing`.

Jangan menyunting kode di dalam folder submodule pada host — perubahan itu hanya diperingatkan, tidak ditolak, dan akan hilang pada checkout berikutnya. Ubah di repo asal, rilis tag baru, naikkan ref.

## 7. Repo privat

Semua kredensial di bawah ini urusan git dan CI Anda — dasbor ini tidak menyimpan token apa pun.

### 7a. Core privat (harness perlu meng-clone-nya)

Tiga pilihan, dari yang paling sederhana:

1. **Pakai checkout lokal**: `CORE_DIR=../core bun run harness` — tidak ada clone, tidak perlu kredensial.
2. **URL SSH di `package.json`**: `"core": { "repo": "git@github.com:org/core.git", "ref": "v1.2.0" }`, lalu pastikan ssh-agent Anda punya kuncinya.
3. **Di CI repo modul**, beri kredensial ke git sebelum langkah harness — deploy key (read-only, di repo core) atau token:

```yaml
      - name: akses core privat
        run: git config --global url."https://x-access-token:${{ secrets.CORE_TOKEN }}@github.com/".insteadOf "https://github.com/"
      - run: bun run harness --web
```

### 7b. Modul privat (host perlu mengambilnya)

URL yang Anda berikan ke `modules:add` tersimpan di `.gitmodules`, jadi **setiap clone host, setiap CI, dan setiap build image** membutuhkan akses baca ke repo modul. Pakai URL SSH agar deploy key bisa dipakai:

```bash
bun modules:add git@github.com:org/mod-billing.git --ref v1.4.2
```

Di CI host, submodule harus ikut ter-checkout beserta kredensialnya:

```yaml
      - uses: actions/checkout@v5
        with:
          submodules: true
          ssh-key: ${{ secrets.MODULE_DEPLOY_KEY }}   # atau: token: ${{ secrets.MODULES_PAT }}
```

Untuk image produksi tidak ada yang khusus: `Dockerfile` menyalin pohon kerja yang sudah ter-checkout (`COPY . .`), jadi kredensial hanya dibutuhkan **saat checkout**, tidak perlu masuk ke dalam image.

Clone baru di mesin lain: `git clone`, lalu `bun install && bun run modules:sync` — sync akan menjalankan `git submodule update --init` sendiri.

### 7c. Kalau server memang tidak boleh punya akses git

Ada jalan keluar: **vendor** modulnya. Salin folder modul ke `modules/Billing` di repo host, lalu daftarkan sebagai modul lokal di `modules.json`:

```jsonc
{ "name": "Billing", "source": "local", "path": "modules/Billing" }
```

lalu `bun install && bun run modules:sync`. Konsekuensinya jujur saja: tidak ada ref terkunci (versinya hanya sejarah git host), pembaruan jadi salin-tempel, dan host **akan** me-lint serta men-typecheck kode itu seperti kode sendiri — pengecualian Biome hanya dipasang untuk submodule. Pakai ini kalau memang tidak ada pilihan lain.

### 7d. Katalog privat (opsional)

Untuk membagi daftar modul internal ke beberapa instalasi, taruh `modules.catalog.json` di URL internal dan isi `MODULES_CATALOG_URL` (atau `MODULES_CATALOG_FILE`). Halaman **Modul** menampilkan statusnya (terpasang / pembaruan / tersedia / tidak cocok) beserta perintah pasangnya. Katalog tidak pernah menjalankan kode: memasang modul tetap tindakan waktu-build, bukan tombol runtime.

## 8. Jebakan yang sering kena

| Gejala | Sebabnya |
|---|---|
| `bun install` di repo modul gagal / paket `@core/*` tidak ketemu | Modul hanya utuh di dalam core — pakai `harness`, jangan install langsung |
| `modules:add` menolak ref Anda | Branch tidak diterima; pakai tag atau commit |
| `modules:sync` gagal menyebut dua commit | HEAD submodule bergeser dari `ref` di `modules.json` — checkout ulang ke ref-nya |
| Modul tidak muncul di menu | Izinnya belum diberikan ke grup, atau modul dimatikan untuk tenant itu di halaman **Modul** |
| Nama constraint kepanjangan saat migrasi MySQL | Nama tabel modul terlalu panjang; ingat `TABLE_PREFIX` ikut dihitung dalam batas 64 karakter |
| Lint host tiba-tiba mengeluh soal kode modul | Modul dipasang sebagai `local` (vendor), bukan submodule — host me-lint modul lokal |

## 9. Daftar periksa rilis modul

- [ ] `bun run harness --web` hijau, dan dengan `DATABASE_URL` tes integrasinya lewat
- [ ] `module.json` → `engines.core` menyebut versi core yang benar-benar Anda uji
- [ ] `package.json` → `core.ref` menunjuk tag core, bukan `main`
- [ ] Tag dibuat dan di-push; catatan rilis menyebut migrasi bila ada
- [ ] Dicoba sekali di host: `modules:add` → `db:generate` → `migrate` → halaman jalan
- [ ] `bun modules:remove <Nama>` dicoba sekali — host kembali bersih
