# Sitemap & SEO Roadmap — Satu URL untuk Satu Isi

| | |
|---|---|
| **Status** | **Selesai F0–F3** (2026-10-02, hari yang sama dengan rencananya). Bukti: `bun test` (unit `sitemap.test.ts`, `trap.test.ts`), `INTEGRATION=1` `config.test.ts`, gate M4 blok **F-7** di `scripts/m4-gate-proof.ts`. Catatan pelaksanaan di §11 |
| **Pemilik** | Core (`apps/web/src/routes/sitemap.xml`, `apps/web/src/routes/robots.txt`, `$lib/server/sitemap.ts`, `$lib/server/trap.ts`, `packages/settings`); modul `Example` sebagai pemakai rujukan canonical |
| **Bergantung pada** | `docs/PRD.md` F-7 (sitemap + robots), R-4 (SEO per halaman), §4.7 (landing `/`, penangkap 404), §4.5 titik perluasan 13 (halaman publik); `docs/MODULES.md` "Sitemap dinamis"; `docs/ROADMAP.md` §8 |
| **Isu pemicu** | Tinjauan handler `sitemap.xml` (2026-10-02): sitemap memuat halaman utilitas (`/theme`, `/lang`), memuat `/` **dan** sasaran landing-nya sebagai dua URL untuk satu isi, canonical halaman landing tidak konsisten dengan alamat yang dilihat pengunjung, panggilan ke API tanpa batas waktu, `loc` tidak di-escape, dan `app.robots_txt` dibaca tapi tidak pernah didaftarkan sebagai setelan |

## 1. Ringkasan

Handler `sitemap.xml` dan `robots.txt` sudah ada dan berfungsi (F-7): halaman publik modul masuk lewat bendera `sitemap` di `public.ts`, entri dinamis lewat `GET /v1/m/<ns>/sitemap`, modul nonaktif disembunyikan (G-8). Yang diperbaiki di sini adalah **kualitas sinyalnya ke mesin pencari** dan **ketahanan handler-nya**, bukan mekanismenya.

Prinsipnya satu kalimat: **setiap isi punya tepat satu URL, dan sitemap hanya memuat URL itu.** Turunannya:

| Hari ini | Sesudah |
|---|---|
| Sitemap memuat `/`, `/theme`, `/lang` | Hanya `/`; `/theme` dan `/lang` memasang `noindex` dan masuk `Disallow` di `robots.txt` |
| Landing `/example` → sitemap memuat `/` **dan** `/example` | Sasaran landing aktif dilewati; hanya `/` yang masuk |
| `/example` memasang canonical `/` selalu; `/catalog` memasang `/catalog` selalu | Canonical = alamat yang dilihat pengunjung; sasaran landing aktif mengaku `/` bahkan saat dibuka langsung |
| `fetch` ke API tanpa batas waktu; satu modul lambat = sitemap menggantung | Batas 3 detik per modul lewat `apiFetchData`; modul yang gagal tidak menyumbang entri |
| `loc` ditulis apa adanya | `&`, `<`, `>`, `"`, `'` di-escape; entri duplikat dibuang |
| `app.robots_txt` dibaca `cfgString` tapi tak ada di registry → tak bisa diubah dari UI | Terdaftar sebagai setelan `text` publik di *Pengaturan → Aplikasi → SEO* |
| Handler web tanpa tes unit | Logika murni di `$lib/server/sitemap.ts` + `sitemap.test.ts`; aturan canonical di `trap.test.ts` |

Tidak ada titik perluasan baru dan tidak ada perubahan kontrak modul: konvensi `GET /v1/m/<ns>/sitemap` tetap `{ path, lastmod }[]`.

## 2. Gap hari ini

1. **Halaman utilitas terindeks.** `CORE_PUBLIC` di `sitemap.xml/+server.ts` memuat `/theme` dan `/lang` — keduanya form cookie (K-7, L-11), bukan konten. Tanpa `noindex` pula.
2. **Duplikat landing.** `hooks.server.ts` menyajikan `app.landing_route` sebagai `/` (F-5), dan `modules/Example/web/public/landing/+page.svelte:107` memasang canonical `/`. Tapi `modulePublicRoutes` menandai `/example` `sitemap: true`, jadi sitemap memuat dua URL untuk satu isi.
3. **Canonical kaku.** Landing Example selalu `/` (salah saat landing adalah `/catalog` dan `/example` dibuka langsung); katalog selalu `/catalog` (salah saat ia landing: `/` mengaku canonical-nya `/catalog`). Padahal `trappedPath(event)` sudah tahu alamat yang dilihat pengunjung.
4. **Tanpa batas waktu.** `fetch` langsung ke `env.API_URL` tanpa `signal`; loader publik lain memakai `apiFor`/`apiFetchData` yang meneruskan origin dan request id.
5. **Tanpa escape.** Slug Example dibatasi regex, tapi kontraknya berlaku untuk modul mana pun; satu `&` merusak seluruh XML.
6. **`app.robots_txt` yatim.** F-7 menjanjikan `robots.txt` yang dapat dikonfigurasi; handler membacanya, tapi kuncinya tidak ada di `packages/settings/src/registry.ts`, jadi tidak pernah ada di form dan tidak pernah ada di `GET /v1/configuration/public`.
7. **Tanpa tes unit.** Bukti hanya dari gate M4/M6 dan tes integrasi API Example — tidak ada yang mengunci "modul nonaktif disembunyikan", "route berparameter dilewati", atau "API gagal tidak merusak keluaran".

## 3. Keputusan desain

**Keputusan A — satu URL per isi.** Sitemap memuat `/`, lalu halaman publik modul yang `sitemap: true` dan **bukan** sasaran landing aktif, lalu entri dinamis. Halaman utilitas core tidak pernah masuk. Entri duplikat (modul mengembalikan path yang sudah statis) dibuang; yang pertama menang.

**Keputusan B — canonical mengikuti alamat pengunjung, dan landing mengklaim `/`.** Helper murni `canonicalPath({ visible, route, landing })` di `$lib/server/trap.ts`: bila path route halaman sama dengan sasaran landing yang aktif → `/`; selain itu path yang dilihat pengunjung (`trappedPath` bila diteruskan, `event.url.pathname` bila langsung), **tanpa query**. `canonicalUrl(event)` di `$lib/server/seo.ts` menggabungkannya dengan origin dan resolusi landing yang sama dengan hooks (`landingTarget`). Halaman modul memakai nilai ini untuk `rel=canonical`, `og:url`, dan `url` JSON-LD; `/product/[slug]` dan `/resolve` sudah benar dan tidak disentuh.

**Keputusan C — handler tipis, logika murni.** `$lib/server/sitemap.ts` memuat `staticEntries()`, `mergeEntries()`, `renderSitemap()`, `escapeXml()` tanpa impor SvelteKit — bisa diuji `bun test` seperti `maintenance.ts`. `+server.ts` hanya mengumpulkan masukan dan memanggil API.

**Keputusan D — API dipanggil lewat jalur yang sama dengan loader lain.** `apiFetchData(event, '/v1/m/<ns>/sitemap', null, { signal })` dengan `AbortSignal.timeout(3000)`. Gagal, 404, atau lewat waktu = modul itu tidak menyumbang entri, tanpa galat, tanpa log (jalur normal "modul tanpa konvensi"). `apiFetchData` mendapat parameter `init` opsional; pemanggil lama tidak berubah.

**Keputusan E — `robots.txt` adalah setelan sungguhan.** `app.robots_txt` didaftarkan bertipe `text`, publik, grup baru `seo` di section `app` (antara *Tema & tata letak* dan *Ketersediaan*), maks 4000 karakter. Nilai baku (kosong = baku) menolak `/dashboard`, `/m/`, `/auth/`, `/theme`, `/lang`, `/join/`. Baris `Sitemap:` selalu ditambahkan handler, apa pun isinya.

**Keputusan F — yang tidak dikerjakan.** Sitemap index (batas 50.000 URL) belum perlu untuk boilerplate; polanya dicatat di `docs/MODULES.md` agar modul besar tahu ke mana arahnya. `hreflang` tidak dipasang: bahasa dipilih lewat cookie, bukan URL, jadi tidak ada URL alternatif per bahasa.

## 4. Alur request

```
GET /sitemap.xml
  └─ +server.ts
       ├─ landing = landingTarget(event)                    // null bila '/' atau tak valid
       ├─ entries = staticEntries({ modulePublicRoutes, enabled, landing })
       │     '/' selalu; route modul: enabled ∧ sitemap ∧ tanpa '[' ∧ path ≠ landing
       ├─ untuk tiap ns aktif yang punya halaman publik:
       │     apiFetchData(event, `/v1/m/${ns}/sitemap`, null, { signal: timeout(3000) })
       │     → { path, lastmod }[] | null
       ├─ merged = mergeEntries(entries, dynamic)          // dedup by path
       └─ renderSitemap(origin, merged)                    // escapeXml pada loc & lastmod

GET /example  (landing aktif = /example)
  └─ load(): canonical = canonicalUrl(event) = origin + '/'      // mengklaim '/'
GET /          (diteruskan ke /example, x-original-path: /)
  └─ load(): canonical = origin + '/'
GET /catalog   (landing aktif = /example)
  └─ load(): canonical = origin + '/catalog'
GET /catalog?q=kopi
  └─ load(): canonical = origin + '/catalog'                     // query dibuang
```

## 5. Perubahan yang dibutuhkan

### 5.1 `apps/web/src/lib/server/sitemap.ts` (baru) + `sitemap.test.ts`

- `escapeXml(s)`; `staticEntries({ routes, enabled, landing })`; `mergeEntries(...lists)`; `renderSitemap(origin, entries)`.
- Tes: `/` selalu ada; `/theme`/`/lang` tidak; modul nonaktif hilang; `[slug]` dilewati; sasaran landing dilewati; `landing = null` memuat semua; duplikat dibuang; `&` di-escape; `lastmod` ikut bila ada.

### 5.2 `apps/web/src/routes/sitemap.xml/+server.ts`

Tipis: kumpulkan `enabled`, `landing`, panggil `apiFetchData` per ns dengan `AbortSignal.timeout(3000)`, render. Header tetap `application/xml` + `max-age=300`.

### 5.3 `apps/web/src/lib/server/session.ts` — `apiFetchData`

Parameter keempat opsional `init?: { signal?: AbortSignal }` diteruskan ke `fetch`.

### 5.4 Canonical — `$lib/server/trap.ts`, `$lib/server/seo.ts` (baru), `hooks.server.ts`

- `trap.ts`: `canonicalPath({ visible, route, landing })` murni + tes di `trap.test.ts`.
- `hooks.server.ts`: ekspor `landingTarget(event)` (pembungkus `routeTarget('app.landing_route', …)` yang sudah dipakai blok landing).
- `seo.ts`: `canonicalUrl(event)` = `event.url.origin + canonicalPath(...)`.
- `modules/Example/web/public/landing/+page.server.ts` dan `catalog/+page.server.ts` mengembalikan `canonical`; `.svelte` keduanya memakai `data.canonical` untuk `rel=canonical`, `og:url`, dan `url` JSON-LD.

### 5.5 `robots.txt` & `noindex`

- `packages/settings/src/registry.ts`: grup `seo` + field `app.robots_txt` (`text`, publik, maks 4000, `order` 10, `width: 'full'`).
- `apps/web/src/routes/robots.txt/+server.ts`: nilai baku ditambah `Disallow: /theme`, `/lang`, `/join/`.
- `(public)/theme/+page.svelte`, `(public)/lang/+page.svelte`: `<meta name="robots" content="noindex">`.
- `apps/api/test/integration/config.test.ts`: daftar grup dan tata letak field `app.*` diperbarui.

### 5.6 Bukti & dokumen — pada commit yang sama (ROADMAP §7 butir 7)

- `scripts/m4-gate-proof.ts` blok F-7: sitemap memuat `/` dan `/product/gayo-arabika`, **tidak** memuat `/example` selama landing = `/example`, tidak memuat `/theme`; `robots.txt` memuat `Disallow: /theme`; `/example` langsung memasang canonical `/`; `/catalog` memasang canonical `/catalog`.
- `docs/PRD.md`: F-7 (aturan satu URL per isi, `app.robots_txt`), R-4 (aturan canonical), §4.7 tabel kunci (`app.robots_txt`).
- `docs/MODULES.md` "Sitemap dinamis": dedup, batas waktu, escape, catatan sitemap index.
- `docs/ROADMAP.md` §8 butir baru.

## 6. Fase & estimasi

| Fase | Isi | Bukti |
|---|---|---|
| **F0 — Handler** | 5.1, 5.2, 5.3 | `sitemap.test.ts` |
| **F1 — robots & noindex** | 5.5 | `config.test.ts`, m4 F-7 |
| **F2 — Canonical** | 5.4 | `trap.test.ts`, m4 F-7 |
| **F3 — Bukti & dokumen** | 5.6 | `bun run check`, `bun test`, m4 |

Semua fase dalam satu hari kerja; tanpa migrasi (setelan baru tidak butuh baris seed).

## 7. Kriteria terima

1. `GET /sitemap.xml` memuat `<loc>${origin}/</loc>` tepat sekali dan **tidak** memuat `/theme` maupun `/lang`.
2. Dengan `app.landing_route = /example`, sitemap **tidak** memuat `/example` tapi memuat `/catalog` dan `/product/<slug>`; dengan `app.landing_route = /`, `/example` kembali masuk.
3. `GET /example` langsung memasang `<link rel="canonical" href="${origin}/">` selama ia landing; `GET /catalog?q=x` memasang `${origin}/catalog`.
4. Modul yang endpoint sitemap-nya 404, galat, atau lewat 3 detik tidak mengubah status 200 maupun entri modul lain.
5. Path dengan `&` dari modul muncul sebagai `&amp;` dan XML tetap valid.
6. `app.robots_txt` tampil di *Pengaturan → Aplikasi → SEO*, nilainya dipakai `GET /robots.txt`, dan baris `Sitemap:` selalu ada.
7. `GET /theme` dan `GET /lang` memuat `<meta name="robots" content="noindex">`.
8. `bun test`, `bun run check`, dan gate M4/M6 hijau.

## 8. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Admin pernah menandai landing lalu mencari `/example` di sitemap dan mengira hilang | Catatan di `docs/MODULES.md`; canonical `/example` → `/` menjelaskan ke mesin pencari juga |
| `AbortSignal.timeout` membuat sitemap tanpa entri dinamis saat API dingin (cold start) | 3 detik cukup untuk satu query; cache 300 detik membatasi dampaknya; tidak ada log agar tidak berisik |
| Field `text` baru menggeser urutan form `app` yang dikunci tes | `config.test.ts` diperbarui pada commit yang sama |
| Modul mengembalikan path absolut atau tanpa `/` | `mergeEntries` menolak entri yang tidak diawali `/` atau diawali `//` |

## 9. Alternatif yang tidak diambil

- **Canonical `/example` tetap `/` selalu.** Salah saat landing bukan `/example`: dua halaman berbeda mengaku satu URL.
- **Membuang `/example` dari `modulePublicRoutes` saat jadi landing.** Registry hasil `modules:sync` statis per build; landing berubah per tenant tanpa restart.
- **Sitemap per modul sekarang (`/sitemap-<ns>.xml`).** Belum ada modul yang mendekati batas; menambah tiga route dan satu index untuk kebutuhan yang belum ada.
- **`hreflang`.** Tidak ada URL per bahasa.

## 10. Rujukan implementasi

| Apa | Di mana |
|---|---|
| Handler sitemap | `apps/web/src/routes/sitemap.xml/+server.ts` |
| Logika murni + tes | `apps/web/src/lib/server/sitemap.ts`, `sitemap.test.ts` |
| Canonical | `apps/web/src/lib/server/trap.ts` (`canonicalPath`), `apps/web/src/lib/server/seo.ts` (`canonicalUrl`), `hooks.server.ts` (`landingTarget`) |
| robots | `apps/web/src/routes/robots.txt/+server.ts`, `packages/settings/src/registry.ts` |
| Pemakai rujukan | `modules/Example/web/public/landing/`, `modules/Example/web/public/catalog/` |
| Konvensi modul | `modules/Example/api/routes.ts` (`GET /sitemap`), `docs/MODULES.md` "Sitemap dinamis" |
| Gate | `scripts/m4-gate-proof.ts` blok F-7, `scripts/m6-gate-proof.ts` |

## 11. Catatan pelaksanaan (2026-10-02)

- **F0–F3 selesai dalam satu commit**, persis rencana §5. Tidak ada migrasi, tidak ada titik perluasan baru.
- **`DEFAULT_ROBOTS` tidak boleh diekspor dari `+server.ts`** — SvelteKit menolak ekspor selain handler; konstanta dibuat lokal di modul.
- **Canonical dirender `href="…"/>`** (self-closing) oleh Svelte; cek gate memakai bentuk itu, bukan `">`.
- **`landingTarget()` memanggil `routeTarget()` yang mencatat `warn`** bila landing menunjuk route hilang/nonaktif; kini bisa terpanggil dari hooks, sitemap, dan canonical dalam satu request — tiga baris peringatan untuk satu salah konfigurasi, dan nol baris saat benar. Diterima; salah konfigurasi memang harus berisik.
- **Verifikasi lokal:** `bun test` (451 lulus), `bun run check` hijau, `APP_ORIGIN=http://api.test INTEGRATION=1 bun test apps/api/test/integration/config.test.ts` lulus (tes integrasi butuh origin `http://api.test` diizinkan — `.env` pemilik tidak memuatnya), gate M4 lewat `vite dev` di port cadangan 5177/5011: seluruh blok F-7/R-4/R-9/F-11 baru hijau; satu cek lama (`href="/_app/` pada URL dalam) merah **hanya** karena `vite dev` tidak memancarkan tautan `/_app/` — ia menuntut build (`scripts/ci/m1-proof.sh` menjalankan `bun build/index.js`).
- **Tes integrasi `maintenance.test.ts` merah di DB dev** (registrasi 403 — pendaftaran mandiri dimatikan/mode pemeliharaan di DB bersama); tidak berkaitan dengan perubahan ini dan hijau di CI.
