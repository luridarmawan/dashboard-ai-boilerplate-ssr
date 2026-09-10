# Membangun Modul di Repositori Anda Sendiri

Tutorial untuk membangun modul yang **hidup di repo Anda sendiri**, punya siklus rilis sendiri, lalu dipasang ke satu atau banyak instalasi dashboard ini. Termasuk kasus repo privat — modulnya privat, core-nya privat, atau keduanya.

Kalau modulnya justru bagian dari produk ini dan tinggal di dalam repo ini, pakai [`Build-Module-for-Boilerplate.md`](./Build-Module-for-Boilerplate.md).

## Model mentalnya dulu — supaya tidak salah jalan

Tiga hal yang sering ditebak salah:

- **Clone core: ya. Fork core: tidak.** Anda tetap meng-clone repo ini seperti biasa — itu sumber template modul dan tempat `bun dev` berjalan saat Anda mencoba. Yang tidak dilakukan adalah mem-fork-nya lalu menaruh modul di dalamnya sebagai kode Anda sendiri: yang di-fork berhenti bisa diperbarui, padahal justru itu yang harus tetap mengalir. Kontraknya memang kebalikan dari fork — modul **tidak menyentuh berkas core sama sekali**, dan itu dijaga penjaga CI (G-6).
- **Repo modul Anda berdiri sendiri.** Ia bukan turunan core dan tidak menyalin core; ia punya remote, tag, dan CI-nya sendiri.
- **Submodule adalah cara HOST memasang, bukan cara Anda bekerja.** Anda mengembangkan di repo biasa; saat dipasang, host menaruhnya sebagai submodule terkunci pada tag.

Selama pengembangan, core dipakai sebagai "SDK": `harness.ts` menyalin modul Anda ke `<core>/modules/<Nama>`, lalu menjalankan install, sync, typecheck, lint, migrasi, dan tes **di sana** — memakai clone yang Anda tunjuk lewat `CORE_DIR`, atau clone sekali-pakai miliknya sendiri di `.core/`. Core-nya alat; modul Anda tetap satu-satunya yang Anda commit.

```
repo-modul-anda/            core (clone sekali pakai di .core/, atau CORE_DIR)
├── module.json             modules/Billing/   ← modul Anda disalin ke sini oleh harness
├── db/tables.ts     ──────▶ install → sync → tsc → biome → db:generate → test
├── api/  web/  test/
└── harness.ts
```

## Peta perjalanannya

Sembilan langkah, dua repositori, dan satu clone core yang dipakai sebagai alat:

```
git clone <core>                     → §0   core, dipakai sebagai alat (tidak di-commit)
bun create module ../mod-billing     → §1   repo modul Anda lahir
git remote add origin … && git push  → §1a  ke repositori ANDA sendiri
CORE_DIR=../core bun run harness     → §2   build, lint, typecheck, migrasi, tes
bun dev di core                      → §3   lihat halamannya di browser
CI repo modul                        → §4   harness yang sama, di setiap push
git tag v1.4.2 && git push origin …  → §5   rilis
bun modules:add <url> --ref v1.4.2   → §6   host memasang, terkunci di tag
git push (di repo host)              → §6   host meng-commit pemasangannya
```

## 0. Prasyarat, dan pertanyaan pertama: apakah saya perlu clone core?

**Ya — clone dulu.** Sekali, di awal, seperti kebiasaan Anda:

```bash
git clone https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr.git core
cd core && bun install
```

Core ini publik dan URL-nya HTTPS, jadi clone di atas tidak meminta kredensial apa pun — tidak perlu kunci SSH, tidak perlu token. (SSH baru berguna kalau Anda memang punya akses tulis dan ingin mendorong ke core, atau kalau Anda memakai mirror privat — §7a.)

Yang **tidak** perlu adalah mem-fork-nya, menyuntingnya, atau memelihara checkout core buatan tangan untuk setiap build. Clone itu dipakai untuk dua hal saja:

1. **Mengambil template modul.** `bun create module` membaca template dari `.bun-create/module` di dalam checkout core — jadi checkout itu harus ada dulu. Tidak ada versi jarak jauhnya.
2. **Menjalankan aplikasinya saat Anda mengembangkan** (`bun dev`), supaya modul Anda bisa dilihat di browser.

Sesudah itu, satu-satunya repo yang Anda commit adalah **repo modul Anda**. Core tidak pernah menerima commit dari Anda — dan bila suatu saat modul Anda menuntutnya, itu cacat kontrak yang perlu dilaporkan, bukan diizinkan.

Untuk build/lint/test, harness bisa mengurus core-nya sendiri (§2) — itulah yang dimaksud "tanpa menyiapkan core secara manual". Di mesin Anda, arahkan saja ke clone yang sudah ada.

Selebihnya: Bun 1.4.x, dan MySQL/PostgreSQL bila Anda mau menjalankan tes integrasi. Core ini berlisensi MIT — bila repositorinya publik, tidak ada kredensial yang perlu disiapkan; untuk core privat (fork atau mirror internal) lihat §7a. Lisensi modul Anda sendiri terserah Anda: template modul tidak menuliskan field `license`, dan modul yang hanya bergantung pada `@core/*` lewat kontrak modul tidak terikat lisensi core.

## 1. Bikin repo modulnya

Dari dalam checkout core tadi:

```bash
cd core
bun create module ../mod-billing          # templatenya dari .bun-create/module di core ini
cd ../mod-billing
bun run rename Billing                    # sekali saja: Hello → Billing (namespace, tabel, izin, route, tes)
git init -b main
git add -A && git commit -m "modul Billing dari template"
```

Bun akan mencetak saran penutup `cd <folder> && bun dev`. **Abaikan** — itu teks bawaan `bun create`, dan repo modul tidak punya skrip `dev`. Skrip yang ada hanya `rename`, `harness`, `typecheck`, dan `test` (tiga yang terakhir memanggil harness). Langkah berikutnya selalu `bun run rename <Nama>` lalu harness.

Peta direktorinya sekarang — dua repo bersebelahan, tidak bersarang:

```
~/kerja/
├── core/            ← clone dashboard-ai-boilerplate-ssr (tidak Anda commit)
└── mod-billing/     ← repo modul ANDA (git init sendiri, remote sendiri)
```

Kalau Anda sedang tidak berada di dalam checkout core: `BUN_CREATE_DIR=<path-core>/.bun-create bun create module ../mod-billing`, atau salin folder `.bun-create/module` sekali dan pakai berulang. Keduanya tetap mengandaikan Anda pernah meng-clone core.

Template ini dibangun dari generator yang sama dengan `bun modgen` (CI core menolak bila keduanya berbeda), jadi isi modul standalone dan modul lokal identik — termasuk contoh hook, job, widget, tool, dan tes integrasi yang sudah jalan.

### 1a. Dorong ke repositori Anda sendiri

Repo modul butuh remote-nya sendiri — bukan remote core. Buat repo kosong di GitHub (atau GitLab, atau git server Anda), lalu:

```bash
cd ~/kerja/mod-billing
git remote add origin https://github.com/<akun-anda>/mod-billing.git   # SSH juga boleh: git@github.com:<akun-anda>/mod-billing.git
git push -u origin main
```

Dengan GitHub CLI, keduanya jadi satu langkah — pilih `--public` atau `--private` sesuai kebutuhan:

```bash
gh repo create <akun-anda>/mod-billing --private --source=. --remote=origin --push
```

Periksa sekali bahwa remote-nya benar-benar milik Anda, bukan core:

```bash
git remote -v      # harus menunjuk mod-billing, BUKAN dashboard-ai-boilerplate-ssr
```

Kalau nanti repo ini privat, host yang memasangnya perlu kredensial baca — §7b.

## 2. Build, lint, test — dua cara memberi core kepada harness

`harness.ts` selalu membutuhkan sebuah core untuk bekerja; yang berbeda hanya dari mana core itu datang.

**a. Pakai clone yang sudah ada** — ini yang Anda pakai sehari-hari, dan yang membuat `bun dev` bisa menyajikan modul Anda:

```bash
CORE_DIR=../core bun run harness
```

**b. Biarkan harness meng-clone sendiri** — tidak ada `CORE_DIR`, jadi ia meng-clone core ke `.core/` di dalam repo modul, pada ref yang tertulis di `package.json`. Ini yang dipakai CI, dan yang berguna saat Anda ingin menguji modul terhadap versi core yang **tepat seperti yang akan dipakai host**:

```bash
bun run harness                                     # clone ke .core/ (sekali; berikutnya dipakai ulang)
bun run harness --web                               # + svelte-check untuk halaman modul
DATABASE_URL=mysql://app:app@127.0.0.1:3306/app bun run harness   # + migrasi & tes integrasi
```

Apa pun caranya, yang dilakukan harness sama: menyalin folder modul ke `<core>/modules/<Nama>`, mendaftarkannya di `modules.json` core itu, `bun install`, `bootstrap`, `tsc`, `biome check`, `db:generate`, lalu tes modul. Core-nya sekali pakai — tidak ada yang perlu Anda commit dari sana.

**`bun install` langsung di repo modul tidak berguna** — dependensinya `workspace:*` dan `tsconfig.json`-nya mengacu `../../tsconfig.base.json`; keduanya baru benar ketika modul berada di dalam core. Itulah alasan harness ada. Kalau Anda melihat galat resolusi paket, hampir pasti karena melewatkan harness.

Core mana yang di-clone cara (b) diatur di `package.json` repo modul:

```jsonc
"core": { "repo": "https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr.git", "ref": "main" }
```

Bisa ditimpa lewat env: `CORE_REPO`, `CORE_REF`, atau `CORE_DIR`. Saat merilis, ganti `ref` ke tag core yang Anda uji (§5).

## 3. Lingkaran kerja di browser

Inilah alasan clone core di §0 berguna. Dua terminal:

```bash
# terminal 1 — di core, sekali saja, biarkan hidup
cd ~/kerja/core && bun dev                  # modul tersaji di /m/billing/…

# terminal 2 — di repo modul, setiap kali Anda mengubah kode modul
cd ~/kerja/mod-billing && CORE_DIR=../core bun run harness
```

`harness` menyalin ulang modul Anda ke `core/modules/Billing` dan menjalankan sync; muat ulang browser. Untuk perubahan kecil pada halaman, Anda juga boleh menyunting langsung di `core/modules/Billing/…` selagi mencoba — **tetapi salin kembali ke repo modul sebelum commit**, karena `harness` berikutnya akan menimpanya.

Yang Anda commit tetap hanya repo modul; `core/modules/Billing` dan `core/modules.json` di clone core itu adalah sisa kerja, bukan hasil kerja.

## 4. CI repo modul

Template sudah membawa `.github/workflows/ci.yml`: MySQL sebagai service, lalu satu langkah `bun run harness --web`. Itu memberi Anda typecheck, lint, migrasi, dan tes integrasi modul di setiap push — tanpa perlu core checkout buatan tangan.

## 5. Merilis

```bash
# 1. selaraskan versi core yang Anda dukung
#    module.json  → "engines": { "core": ">=1.2.0" }
#    package.json → "core": { "ref": "v1.2.0" }   (harness & CI ikut ref ini)
# 2. commit dan dorong ke repo modul Anda
git add -A && git commit -m "rilis v1.4.2"
git push origin main
# 3. tag — inilah yang dipasang host, jadi ia harus ada di remote
git tag v1.4.2
git push origin v1.4.2
```

Tag yang hanya ada di mesin Anda tidak bisa dipasang siapa pun: `modules:add` mengambilnya dari remote. Kalau ragu, `git ls-remote --tags origin` harus menyebut tag itu.

`engines.core` bukan hiasan: host memeriksanya (G-11), dan katalog menandai modul yang tidak cocok sebagai *tidak cocok* tanpa memberi perintah pasang.

## 6. Memasang di host

```bash
bun modules:add https://github.com/tim/mod-billing.git --ref v1.4.2   # modul privat: pakai URL SSH, lihat §7b
bun db:generate && bun run --cwd packages/db migrate
git add modules.json .gitmodules biome.json bun.lock packages/db/migrations modules/Billing
git commit -m "modul Billing v1.4.2"
git push                     # repo HOST, bukan repo modul — inilah yang dipakai deploy
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

Semua kredensial di bawah ini urusan git dan CI Anda — dashboard ini tidak menyimpan token apa pun.

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
| Bingung modul ditaruh di mana setelah clone core | **Bersebelahan dengan core, bukan di dalamnya.** Yang masuk ke `core/modules/<Nama>` adalah salinan yang dibuat harness — sisa kerja, bukan tempat Anda menulis kode |
| Perubahan di `core/modules/<Nama>` hilang | Itu salinan; harness berikutnya menimpanya. Sunting di repo modul, atau salin balik sebelum commit |

## 9. Daftar periksa rilis modul

- [ ] `bun run harness --web` hijau, dan dengan `DATABASE_URL` tes integrasinya lewat
- [ ] `module.json` → `engines.core` menyebut versi core yang benar-benar Anda uji
- [ ] `package.json` → `core.ref` menunjuk tag core, bukan `main`
- [ ] Tag dibuat dan **ada di remote** (`git ls-remote --tags origin` menyebutnya); catatan rilis menyebut migrasi bila ada
- [ ] Dicoba sekali di host: `modules:add` → `db:generate` → `migrate` → halaman jalan
- [ ] `bun modules:remove <Nama>` dicoba sekali — host kembali bersih
