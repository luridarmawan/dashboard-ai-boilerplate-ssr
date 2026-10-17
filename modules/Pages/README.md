# Pages

Halaman statis di akar situs (`/tentang-kami`, `/kebijakan-privasi`) dengan permalink yang bisa diubah tanpa memutus URL lama: slug lama halaman yang pernah **Published** menjawab **HTTP 301** langsung ke slug terbaru. Spesifikasinya: [`docs/PAGES.md`](../../docs/PAGES.md) (§8).

## Menyalakan

Halaman berada di akar domain, bentuk URL yang tidak bisa dideklarasikan sebagai route. Modul ini memakai **penangkap 404** core (titik perluasan 13, `notFound: true`): pilih **Pages — /pages** di **Pengaturan → Aplikasi → Penangkap halaman 404**, lingkup **Global** (pengunjung anonim membaca lingkup global). Hanya satu modul yang bisa menjadi penangkap; selama `Example — /resolve` yang dipilih, halaman Pages tidak tampil (dasbor memperingatkannya).

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
| slug dipakai halaman lain / masih jadi alamat lama halaman lain | 409 (`details.reason`: `slug_taken` / `slug_redirected`) |
| halaman kembali Draft | redirect-nya nonaktif (404) sampai Published lagi |
| halaman dihapus | slug + semua redirect-nya dihapus dalam satu transaksi → 404, slug bebas dipakai lagi |

Invarian yang menjaga semua itu: dalam satu tenant, sebuah slug dimiliki **satu** halaman (slug saat ini) **atau satu** redirect (slug lama), tidak keduanya. Redirect menunjuk **halaman** (`page_id`), bukan slug tujuan, jadi rantai mustahil secara konstruksi. Perubahan slug dan penulisan redirect berjalan dalam **satu transaksi database** (MySQL/MariaDB/PostgreSQL); bila salah satunya gagal, keduanya batal. SQLite (`bun:sqlite`) tidak bisa menahan transaksi melewati `await`, jadi di sana langkahnya berurutan tanpa transaksi.

Logika ada di [`api/permalinks.ts`](./api/permalinks.ts) — `planSlugChange()` murni (diuji unit), `applySlugChange()`, `resolvePath()`. Status 301 dilempar di server oleh [`web/public/resolve/+page.server.ts`](./web/public/resolve/+page.server.ts); hooks core meneruskan status dan `Location` apa adanya, jadi browser, crawler, dan klien HTTP menerima 301 sungguhan.

## Dasbor

`/m/pages/pages` — daftar (cari judul/slug, lapis fetch), buat, ubah, hapus (dengan konfirmasi). Isi ditulis dalam Markdown lewat `web/lib/MarkdownEditor.svelte`: toolbar format (tebal, miring, subjudul, kutipan, kode, daftar, tautan, gambar; Ctrl+B/I/K) dan empat tampilan — **Visual** (WYSIWYG, [Milkdown](https://milkdown.dev) di `web/lib/visual.ts`; tampilan baku), **Tulis** (sumber Markdown), **Pratinjau**, **Berdampingan** (layar lebar). Format tersimpan tetap **Markdown**: tampilan Visual membaca dan menulis Markdown yang sama, jadi API, renderer, dan aturan permalink tidak berubah. Milkdown menulis ulang Markdown dengan gayanya sendiri (`*miring*`, bullet `*`) setelah ada suntingan — maknanya tetap; sekadar membuka tampilan Visual tidak mengubah apa pun. Pratinjau memakai aturan render yang sama dengan API (`api/markdown-rules.ts`: parser, opsi, allowlist) dan komponen tampilan yang sama dengan halaman publik (`web/lib/MarkdownBody.svelte`), jadi yang terlihat di editor adalah yang dilihat pengunjung. Tampilan Visual bergaya Notion (`web/lib/VisualEditor.svelte` + `web/lib/visual.ts`, dari plugin headless `@milkdown/kit` — bukan Crepe, supaya tanpa Vue/CodeMirror/KaTeX): ketik **`/`** di awal baris untuk menu blok (teks, subjudul, daftar, kutipan, blok kode, tabel, garis pemisah, gambar — hanya blok yang dirender halaman publik; ketik untuk memfilter, ↑/↓/Enter, Esc menutup), **pegangan blok** di kiri tiap blok (`+` menambah blok di bawah dan membuka menu `/`, ⋮⋮ diseret untuk memindah blok), dan **toolbar melayang** saat teks dipilih (tebal, miring, kode, tautan). Semua markup memakai token tema dan i18n. Server menyanitasi dengan sanitize-html, browser dengan DOMPurify. Milkdown dan renderer pratinjau dimuat saat tampilannya dibuka (impor dinamis), jadi tidak menambah JS awal dasbor; bila Milkdown gagal dimuat, textarea Markdown muncul sebagai gantinya. Tanpa JavaScript, editor menjadi textarea biasa yang tetap tersimpan. Slug halaman yang sudah ada diubah di kartu **Permalink**: dengan JavaScript dikirim lewat fetch, permalink dan daftar alamat lama diperbarui di tempat, dan toast menyebut alamat lama yang kini dialihkan; tanpa JavaScript, aksi yang sama menjawab dengan halaman penuh dan pemberitahuan.

## Gambar unggulan & kartu share

Kartu **Gambar unggulan** di halaman edit: pilih berkas (JPEG/PNG/WebP/GIF, maks. 5 MB; ideal 1200 × 630), langsung tampil beserta ukurannya, dengan peringatan bila terlalu kecil (< 600 × 315) atau rasionya jauh dari 1,91:1. Ada juga teks alternatif dan pratinjau kartu share (gambar, domain, judul, ringkasan). Unggah dan hapus berjalan lewat AJAX; tanpa JavaScript, form multipart biasa.

Berkas disimpan lewat `storeUpload()` core sebagai berkas **publik** jenis `pages.featured`, dengan ukuran pikselnya di `meta` (dibaca dari header oleh `api/image-size.ts`). Gambar yang diganti atau milik halaman yang dihapus ikut dihapus. SVG ditolak karena media sosial tidak menampilkannya.

Halaman publik menampilkan gambar di atas isi, lalu mengisi `og:image` (URL absolut), `og:image:width`/`height`/`type`/`alt`, `og:site_name`, dan `twitter:card=summary_large_image`. Tanpa gambar, `twitter:card=summary`. URL-nya `/v1/m/pages/media/<id>`, bukan `/v1/files/<id>/content`: route core itu butuh header `X-Client-ID` untuk pembaca anonim, yang tidak dikirim crawler. Route modul ini memakai tenant situs dan hanya menyajikan gambar halaman yang Published.

## API (`/v1/m/pages`)

| Route | Izin | Isi |
|---|---|---|
| `GET /resolve?path=` | publik | `{ kind: 'page', page }` · `{ kind: 'redirect', location }` · 404 |
| `GET /sitemap` | publik | halaman Published, hanya selama modul ini penangkap 404 |
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

## Batasan yang diketahui

Penangkap 404 core hanya menangani `GET` yang meminta HTML (`Accept: text/html`, seperti browser dan Googlebot). `HEAD` dan request dengan `Accept: */*` (mis. `curl` tanpa header) mendapat 404 bawaan, bukan 301. Itu perilaku core yang disengaja (`wantsHtml()` di `apps/web/src/lib/server/trap.ts`), bukan perilaku modul ini.
