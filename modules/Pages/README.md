# Pages

Halaman statis di akar situs (`/tentang-kami`, `/kebijakan-privasi`) dengan permalink yang bisa diubah tanpa memutus URL lama: slug lama halaman yang pernah **Published** menjawab **HTTP 301** langsung ke slug terbaru. Spesifikasinya: [`docs/PAGES.md`](../../docs/PAGES.md) (§8).

## Menyalakan

Halaman berada di akar domain (`/<slug>`), tanpa setelan apa pun. Setiap halaman mendaftarkan URL-nya di **registry permalink core** (PRD F-12, `@app/api/permalinks`) di transaksi yang sama dengan halamannya, dan `public.ts` menandai `/pages` sebagai halaman `permalinks: true` yang merendernya. Penangkap 404 (`app.not_found_route`) tidak dipakai, jadi tetap bebas untuk modul lain (mis. demo pola URL Example).

## Aturan permalink

| Kejadian | Hasil |
|---|---|
| `/<slug>` halaman Published | 200, canonical `/<slug>` |
| `/<slug-lama>` | 301 → `/<slug-terbaru>` (`Location` absolut, query string ikut) |
| `/About-Us/` (huruf besar, slash akhir) | 301 → `/about-us` |
| slug tak dikenal, halaman Draft | 404 bawaan core |
| slug Draft yang belum pernah Published diubah | tidak ada redirect |
| slug diubah berkali-kali (`a → b → c`) | `a` dan `b` sama-sama 301 langsung ke `c` — tanpa rantai |
| kembali ke slug lama sendiri (`c → a`) | redirect `a` dihapus (tidak menunjuk diri sendiri), `b`,`c` → `a` |
| slug dipakai konten lain (modul apa pun) / masih jadi alamat lama konten lain / dipakai halaman aplikasi | 409 (`details.reason`: `slug_taken` / `slug_redirected` / `slug_reserved`) |
| halaman kembali Draft | redirect-nya nonaktif (404) sampai Published lagi |
| halaman dihapus | slug + semua redirect-nya dihapus dalam satu transaksi → 404, slug bebas dipakai lagi |

Semua aturan ini milik registry core, bukan modul ini: dalam satu tenant sebuah path dipegang **satu** baris (unik lintas modul), redirect menunjuk **konten** (`module` + `target`) sehingga rantai mustahil, dan core yang menjawab 301 (`Location` absolut) sebelum halaman ini dirender — untuk browser, crawler, `curl`, dan `HEAD`. Perubahan slug, baris registry, dan baris halaman berjalan dalam **satu transaksi database** (`inTransaction` dari `@core/db`); bila salah satu gagal, semuanya batal. SQLite (`bun:sqlite`) tidak bisa menahan transaksi melewati `await`, jadi di sana langkahnya berurutan tanpa transaksi.

Aturan murninya diuji di `apps/api/test/permalinks.test.ts`. Modul ini hanya memanggil `claimPermalink` / `setPermalinkLive` / `releasePermalinks` (`api/routes.ts`) dan merender konten yang ditunjuk registry (`web/public/resolve/`). Seed mendaftarkan halaman yang belum punya URL di registry.

## Dasbor

`/m/pages/pages` — daftar (cari judul/slug, lapis fetch), buat, ubah, hapus (dengan konfirmasi). Isi ditulis dalam Markdown lewat `web/lib/MarkdownEditor.svelte`: toolbar format (tebal, miring, subjudul, kutipan, kode, daftar, tautan, gambar; Ctrl+B/I/K) dan empat tampilan — **Visual** (WYSIWYG, [Milkdown](https://milkdown.dev) di `web/lib/visual.ts`; tampilan baku), **Tulis** (sumber Markdown), **Pratinjau**, **Berdampingan** (layar lebar). Format tersimpan tetap **Markdown**: tampilan Visual membaca dan menulis Markdown yang sama, jadi API, renderer, dan aturan permalink tidak berubah. Milkdown menulis ulang Markdown dengan gayanya sendiri (`*miring*`, bullet `*`) setelah ada suntingan — maknanya tetap; sekadar membuka tampilan Visual tidak mengubah apa pun. Pratinjau memakai aturan render yang sama dengan API (`api/markdown-rules.ts`: parser, opsi, allowlist) dan komponen tampilan yang sama dengan halaman publik (`web/lib/MarkdownBody.svelte`), jadi yang terlihat di editor adalah yang dilihat pengunjung. Tampilan Visual bergaya Notion (`web/lib/VisualEditor.svelte` + `web/lib/visual.ts`, dari plugin headless `@milkdown/kit` — bukan Crepe, supaya tanpa Vue/CodeMirror/KaTeX): ketik **`/`** di awal baris untuk menu blok (teks, subjudul, daftar, kutipan, blok kode, tabel, garis pemisah, gambar — hanya blok yang dirender halaman publik; ketik untuk memfilter, ↑/↓/Enter, Esc menutup), **pegangan blok** di kiri tiap blok (`+` menambah blok di bawah dan membuka menu `/`, ⋮⋮ diseret untuk memindah blok), dan **toolbar melayang** saat teks dipilih (tebal, miring, kode, tautan). Semua markup memakai token tema dan i18n. Server menyanitasi dengan sanitize-html, browser dengan DOMPurify. Milkdown dan renderer pratinjau dimuat saat tampilannya dibuka (impor dinamis), jadi tidak menambah JS awal dasbor; bila Milkdown gagal dimuat, textarea Markdown muncul sebagai gantinya. Tanpa JavaScript, editor menjadi textarea biasa yang tetap tersimpan. Slug halaman yang sudah ada diubah di kartu **Permalink**: dengan JavaScript dikirim lewat fetch, permalink dan daftar alamat lama diperbarui di tempat, dan toast menyebut alamat lama yang kini dialihkan; tanpa JavaScript, aksi yang sama menjawab dengan halaman penuh dan pemberitahuan.

## Gambar unggulan & kartu share

Kartu **Gambar unggulan** di halaman edit: pilih berkas (JPEG/PNG/WebP/GIF, maks. 5 MB; ideal 1200 × 630), langsung tampil beserta ukurannya, dengan peringatan bila terlalu kecil (< 600 × 315) atau rasionya jauh dari 1,91:1. Ada juga teks alternatif dan pratinjau kartu share (gambar, domain, judul, ringkasan). Unggah dan hapus berjalan lewat AJAX; tanpa JavaScript, form multipart biasa.

Berkas disimpan lewat `storeUpload()` core sebagai berkas **publik** jenis `pages.featured`, dengan ukuran pikselnya di `meta` (dibaca dari header oleh `api/image-size.ts`). Gambar yang diganti atau milik halaman yang dihapus ikut dihapus. SVG ditolak karena media sosial tidak menampilkannya.

Halaman publik menampilkan gambar di atas isi, lalu mengisi `og:image` (URL absolut), `og:image:width`/`height`/`type`/`alt`, `og:site_name`, dan `twitter:card=summary_large_image`. Tanpa gambar unggulan, kartu share memakai **gambar share default** dari Pengaturan → Aplikasi (`app.share_image`), atau `/og-image.jpg` bawaan bila kosong — lewat `shareImage(event)` di `$lib/server/seo`; artikelnya sendiri tetap tanpa gambar. URL-nya `/v1/m/pages/media/<id>`, bukan `/v1/files/<id>/content`: route core itu butuh header `X-Client-ID` untuk pembaca anonim, yang tidak dikirim crawler. Route modul ini memakai tenant situs dan hanya menyajikan gambar halaman yang Published.

## API (`/v1/m/pages`)

| Route | Izin | Isi |
|---|---|---|
| `GET /resolve?path=` | publik | halaman Published yang ditunjuk registry: `{ kind: 'page', page }` · `{ kind: 'redirect', location }` · 404 |
| `GET/POST /pages`, `GET/PUT/DELETE /pages/:id` | `pages.page.*` | CRUD; `PUT` boleh membawa `slug` |
| `PUT /pages/:id/slug` | `pages.page.edit` | `{ page, change: { changed, redirected, from, to } }` |
| `POST /pages/:id/image` (multipart `file`, `alt`) · `DELETE /pages/:id/image` | `pages.page.edit` | pasang / hapus gambar unggulan |
| `GET /media/:fileId` | publik | gambar unggulan halaman Published (og:image) |

## Tes

```bash
bun test modules/Pages/test/permalinks.test.ts                       # aturan murni, tanpa DB
APP_ORIGIN=http://api.test INTEGRATION=1 bun test modules/Pages/test/integration
# 301/200/404 lewat HTTP sungguhan — butuh web + API yang memakai DB yang sama:
APP_ORIGIN=http://api.test INTEGRATION=1 PAGES_WEB_URL=http://127.0.0.1:5177 bun test modules/Pages/test/web
# …restart server, lalu ulangi dengan PAGES_WEB_KEEP=<run id yang dicetak> untuk membuktikan redirect bertahan
WEB_URL=http://127.0.0.1:5177 ADMIN_EMAIL=… ADMIN_PASSWORD=… bunx playwright test e2e/pages-permalink.e2e.ts   # dari apps/web
```

Sitemap: URL halaman Published masuk `sitemap.xml` lewat registry core (`GET /v1/permalinks/sitemap`).
