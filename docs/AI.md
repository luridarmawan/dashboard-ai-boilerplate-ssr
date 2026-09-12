# Modul AI

| | |
|---|---|
| **Status** | Tersedia sejak M5 (FR-H P0) |
| **Berkas** | `modules/AI/` — dibangun dengan kontrak modul yang sama dengan modul pihak ketiga (H-1) |
| **Provider** | Endpoint apa pun yang kompatibel-OpenAI; provider adalah **konfigurasi**, bukan kode (H-2) |

## Tiga cara mematikan (H-1)

1. **Lepas dari `modules.json`** — tidak ikut ter-build sama sekali; `bun run proof:m5:gate4` membuktikan tidak ada jejak AI di registry, route, OpenAPI, maupun bundel web.
2. **Nonaktifkan per tenant** di halaman **Modul** — menu, route API, widget, dan halaman modul hilang untuk tenant itu; tabelnya tetap ada.
3. **`ai.enable = false`** di **Pengaturan → AI** — modul tetap terpasang, tetapi setiap permintaan chat ditolak dengan pesan yang jelas.

## Ganti provider (P-10)

Semua di **Pengaturan → AI** (per tenant, fallback global; berlaku pada request berikutnya di semua instance):

| Kunci | Arti |
|---|---|
| `ai.baseurl` | Base URL kompatibel-OpenAI, mis. `https://api.openai.com/v1`, `https://api.groq.com/openai/v1`, proxy lokal, atau `http://127.0.0.1:4010/v1` (mock) |
| `ai.key` | API key — tipe `secret`: tidak pernah dikirim ke browser, disamarkan di log & audit |
| `ai.model` | Model baku; klien boleh menimpa lewat field `model` |
| `ai.system_prompt` | Disuntikkan bila request belum punya pesan `system` (H-5) |
| `ai.max_tokens`, `ai.price_*_per_mtok`, `ai.log_retention_days` | Batas keluaran, estimasi biaya (untuk penyedia implisit ini; profil penyedia punya daftar harga sendiri, H-10), retensi log (M-3) |

Tanpa API key, permintaan dijawab **422** dengan alasan `no_api_key` dan tautan ke Pengaturan — bukan galat generik (H-4).

## Lebih dari satu penyedia & model (H-10)

**Pengaturan → AI** adalah penyedia *implisit* — cukup untuk satu provider. Untuk beberapa provider atau model dengan harga berbeda, admin (`ai.provider.manage`) membuat **profil penyedia** di **Penyedia AI** (`/m/ai/providers`): nama, kode, base URL kompatibel-OpenAI, API key (rahasia: tidak pernah ditampilkan lagi; `***`/kosong = pertahankan), model baku, dan **daftar model berharga** — satu baris per model: `model | label | harga input per 1M token | harga output per 1M token`. Tombol **Uji koneksi** menjalankan probe kemampuan (AI-Roadmap §4.1) dengan key tersimpan: `GET /models`, lalu `/responses` dan `/chat/completions`, streaming, reasoning, dan tools — membuktikan URL + key, menampilkan id model yang bisa dimasukkan ke daftar, dan merekam matriks kemampuannya.

Aturannya:

- Profil pertama otomatis **baku**; percakapan baru memakainya. Selama belum ada profil, Pengaturan → AI yang dipakai (kode penyedia di log = kosong) — perilaku lama utuh.
- Pengguna memilih **provider + model per percakapan** dari pemilih di header chat (`PATCH /v1/m/ai/conversations/:id` dengan `provider` (kode) dan `model`; `POST /v1/m/ai/conversations` menerima keduanya). Request `chat/completions` boleh menamai `provider` langsung; `model` menimpa model baku profil. Profil nonaktif hilang dari pemilih dan ditolak `422 provider_not_found`.
- **Biaya** tiap panggilan dihitung dari baris harga model yang menjawab (tersimpan sebagai `price_*_micro` = mikro-unit mata uang per 1M token; `cost_micro` = token × harga ÷ 1M). Model tanpa baris harga → biaya `null`. Kolom `ai_calls.provider` mencatat kode profilnya.
- Pemilih (`GET /v1/m/ai/providers/options`, izin `ai.chat.read`) hanya membawa kode, nama, dan model — bukan URL atau key. Menghapus profil melepaskan percakapan yang menggunakannya kembali ke baku.
- Hapus itu lunak (`deleted_at`), sementara kunci unik `(client_id, code)` ikut menghitung baris terkubur — jadi **membuat profil dengan kode yang pernah dihapus akan membangkitkan baris lama itu**, bukan menolaknya: id-nya kembali (audit tetap menunjuk sesuatu), sedangkan URL, key, model, dan seluruh kolom hasil probe diganti yang baru — kapabilitas endpoint lama tidak boleh diwariskan ke endpoint baru.

### Uji koneksi per model

Probe tingkat penyedia menjawab *"apa yang dikuasai base URL ini"* — dan ia selalu menjalankannya dengan **model baku**. Itu jawaban yang salah untuk sebagian besar baris daftar harga: di balik satu base URL lazimnya ada model reasoning, model chat saja, dan model tanpa function calling. Karena itu setiap baris daftar harga punya tombol **Uji model** sendiri (`POST /v1/m/ai/providers/:id/models/test`, izin `ai.provider.manage`), dan kolom **Kemampuan** di sebelahnya menampilkan matriks milik model itu.

- Probe-nya sama persis, hanya id modelnya yang berbeda. Modelnya diambil dari daftar penyedia, **tidak pernah** dari request sebagai teks bebas — probe membelanjakan key milik tenant, jadi model di luar daftar dijawab `404`.
- Hasilnya disimpan di baris modelnya (`ai_models`: `capabilities`, `capabilities_at`, `preferred_endpoint`, `last_status`, `last_error`, `last_tested_at`, `last_probe_ms` — migrasi 0024, aditif). Aturannya sama dengan tingkat penyedia: **probe yang gagal tidak menghapus matriks yang sudah terbukti**; kegagalannya dicatat di sebelahnya.
- **Matriks bertahan saat profil disimpan.** Menyimpan profil menulis ulang seluruh daftar harga (hapus lalu sisipkan), tetapi matriks melekat pada *id model*, bukan pada baris yang kebetulan memuatnya — tanpa itu, mengubah satu harga akan menghapus semua yang sudah diuji.
- Uji koneksi tingkat penyedia **ikut mengisi baris model bakunya**, karena uji itu memang probe atas model baku.
- Di UI hasil disimpan per id model, bukan satu slot "hasil terakhir" — alasan menguji model kedua adalah membandingkannya dengan yang pertama. Jalur tanpa JavaScript (`?/testModel`) memanggil endpoint API yang sama.

Tabel: `ai_providers`, `ai_models` (per tenant), kolom `ai_conversations.provider_id`, `ai_calls.provider` (migrasi 0012; kolom probe per model 0024). Bukti: `modules/AI/test/integration/providers.test.ts` (dua provider tiruan; routing per percakapan, biaya dari daftar harga, key tak pernah bocor, probe kemampuan, profil nonaktif, hapus) — termasuk satu penyedia dengan **dua model yang berbeda verdict** di balik satu base URL dan satu key: reasoning ✓/✗, tools ✓/✗, rekomendasi ★/–, lalu diperiksa lagi setelah daftar harga disimpan.

## Kuota & saldo (B-6, H-14)

Dua batas yang saling bebas, keduanya opsional dan diperiksa **sebelum** penyedia dipanggil:

| Batas | Tempat mengatur | Cara hitung | Habis → |
|---|---|---|---|
| Token per bulan, tenant | **Pengaturan → AI → Kuota token tenant / bulan** (`ai.quota_tokens_month`, 0 = tanpa batas) | jumlah `tokens_total` panggilan sukses di `ai_calls` sejak awal bulan kalender UTC | `429 rate_limited`, `reason: tenant_quota` |
| Token per bulan, per pengguna | `ai.quota_tokens_user_month` | sama, difilter pengguna | `reason: user_quota` |
| Saldo prabayar tenant | **Analitik AI → Kuota & saldo** (izin `ai.credit.manage`): top-up, koreksi negatif, atau hapus batas | `ai_credits.balance_micro` dikurangi `cost_micro` tiap panggilan sukses (harga dari daftar model, H-10); tanpa baris/NULL = tanpa batas | `reason: credit_exhausted` saat ≤ 0 |

Pemakaian ditulis setelah respons selesai, jadi satu panggilan bisa melampaui batas sebesar dirinya sendiri — itu harga agar jalur panas tidak menunggu. Halaman chat menampilkan sisa kuota/saldo di bawah header saat ada batas, dan pesan penolakan yang jelas saat habis. Setiap top-up/koreksi masuk `ai_credit_ledger` dan audit `ai.credit.adjust`; `GET /v1/m/ai/quota` (izin `ai.chat.read`) memberi status untuk pemanggil, `GET /v1/m/ai/analytics` membawa blok `quota` untuk tenant. Bukti: `modules/AI/test/integration/quota.test.ts`.

## Analitik penggunaan (H-15)

**Analitik AI** (`/m/ai/analytics`, izin `ai.log.read`) merangkum log panggilan: total panggilan (ok/gagal/dibatalkan), token masuk/keluar, biaya estimasi; grafik token per hari (CSS, tanpa pustaka, jalan tanpa JavaScript); tabel per penyedia & model dan per pengguna, diurutkan biaya. Rentang 7/30/90 hari (`GET /v1/m/ai/analytics?days=`; hari kalender UTC, batang terakhir = hari ini). Agregasi dilakukan di API dari baris `ai_calls` tenant aktif — netral dialect — dengan batas 100.000 baris terbaru per rentang (`truncated: true` bila terpotong). Retensi log (M-3) membatasi seberapa jauh analitik bisa melihat ke belakang.

## Lampiran (H-11) dan threading pesan (H-12)

**Lampiran.** `POST /v1/m/ai/attachments` (multipart `file`, izin `ai.chat.create`) menyimpan berkas lewat layanan berkas (Q-16) sebagai `kind: ai.attachment`, privat, milik pengirim — gambar (PNG/JPEG/GIF/WebP), teks, CSV, JSON, Markdown, maks. 5 MB. Id-nya lalu dinamai di `chat/completions` lewat `attachments: [id…]` (maks. 5) dan menempel pada pesan pengguna yang tersimpan (tabel `ai_attachments`, migrasi 0017). Ke model: berkas teks **dikutip** di belakang pesan (maks. 20.000 karakter per berkas), gambar dikirim sebagai `image_url` data URL (content parts OpenAI, untuk model vision). Yang tersimpan di riwayat hanya teks pengguna aslinya; lampiran tampil sebagai chip/thumbnail dengan URL `/v1/files/<id>/content` yang hanya bisa dibuka pemiliknya (atau pemegang `file.read`). Lampiran orang lain atau berkas bukan `ai.attachment` ditolak 422 `attachment_invalid`. Di halaman chat: tombol klip di komposer (jalur tanpa JavaScript mengunggah lalu memanggil API; jalur JavaScript lewat jembatan `/m/ai/chat/stream`).

**Threading.** Setiap pesan tersimpan punya `parent_id` (kolom baru di `ai_messages`): pesan pengguna menggantung di balasan sebelumnya (null di akar), balasan menggantung di pesan pengguna. Dua operasi membuat cabang:
- **Buat ulang** — `chat/completions` dengan `parent_id: <id pesan pengguna>` dan `regenerate: true`: tidak ada baris pengguna baru, balasan baru menjadi *saudara* balasan lama.
- **Ubah lalu cabang** — `parent_id: <parent pesan yang diubah>` (`null` untuk pesan pertama) dengan teks baru: pesan pengguna baru menjadi saudara pesan lama, dan balasannya memulai cabang baru.

`parent_id` yang tidak ada di percakapan → 422 `parent_not_found`; tanpa `parent_id`, pesan baru menggantung di pesan terakhir. Respons (non-streaming `x_messages`, streaming frame `crk.messages` sebelum `[DONE]`) menyebut id pesan pengguna dan balasan yang tersimpan, sehingga klien bisa langsung membuat ulang/mencabang. `GET /conversations/:id` tetap mengembalikan **semua** pesan (dengan `parentId` dan `attachments`); klien memilih satu jalur — halaman chat memakai `modules/AI/web/lib/thread.ts` (`activePath`, `siblingsAlong`): `?m=<id>` memilih daun, lalu turun ke keturunan terbaru; panah ‹ 1/2 › di bawah pesan berpindah antar versi. Percakapan lama (tanpa parent) ditautkan berurutan sekali saat pertama dibaca. Bukti: `modules/AI/test/integration/threading.test.ts`, `modules/AI/test/thread.test.ts`.

## Chat mengambang berkonteks halaman (H-13)

Widget shell `ai.floating_chat` (izin `ai.chat.create`) menaruh tombol di pojok kanan bawah **semua halaman dasbor** kecuali halaman chat sendiri. Tanpa JavaScript tombol itu tautan ke `/m/ai/chat`; dengan JavaScript ia membuka panel yang memakai jembatan streaming yang sama (`/m/ai/chat/stream`) dan mengirim **konteks halaman** — nama aplikasi, breadcrumb, path URL, judul dokumen, dan teks yang sedang disorot pengguna (maks. 1500 karakter) — lewat field `context`. API menyisipkannya sebagai pesan `system` **kedua**, di belakang prompt system tenant (`ai.system_prompt`) atau prompt yang dikirim klien, dan **tidak pernah menyimpannya** ke riwayat percakapan (maks. 4000 karakter, 422 bila lebih). Percakapan yang dimulai dari panel tersimpan seperti biasa dan bisa dilanjutkan lewat tautan "Buka percakapan penuh".

`context` juga terbuka untuk klien API lain (`POST /v1/m/ai/chat/completions`, ekstensi kami) — misalnya plugin editor yang ingin menyertakan berkas yang sedang dibuka.

## Streaming end-to-end (H-3)

`POST /v1/m/ai/chat/completions` dengan `stream: true` meneruskan byte SSE provider apa adanya: **provider → API → SvelteKit (`/m/ai/chat/stream`) → UI**. Pembatalan mengalir balik: menutup tab atau menekan *Berhenti* membatalkan request browser → SvelteKit membatalkan request ke API → API membatalkan request ke provider; panggilan dicatat dengan status `cancelled`. Pesan pertama sebuah chat baru lewat jalur streaming membuat percakapannya lebih dulu (jembatan memanggil `POST /v1/m/ai/conversations`, mengembalikan id di header `x-conversation-id`), lalu halaman mendarat di `?c=<id>` — sehingga pertukaran pertama pun tersimpan (H-6), sama seperti jalur tanpa JavaScript.

Tanpa JavaScript, form chat tetap bekerja: jawaban diambil utuh lalu halaman dirender ulang dengan riwayat.

## Tool modul (titik perluasan 8, I-3)

Asisten bisa **memanggil tool** yang disumbangkan modul lewat `api/tools.ts` (`defineTools`, lihat [`MODULES.md` §3](./MODULES.md)). Modul AI sendiri tidak tahu tool apa yang ada — ia bertanya ke registry core:

1. Sebelum memanggil provider, API mengambil tool yang **boleh dipakai user ini di tenant aktif** (modul aktif + izin dipegang) dan mengirimnya sebagai OpenAI `tools`, dengan nama kawat `<ns>_<nama>` (mis. `example_list_products`).
2. Bila model menjawab `tool_calls`, setiap panggilan dijalankan lewat `callTool` registry — izin, tenant (`forTenant`), dan skema argumen ditegakkan **di sana**, lalu diaudit (`tool.call`) — hasilnya dikirim balik sebagai pesan `tool`, dan provider dipanggil lagi. Maksimal 5 putaran per giliran; putaran terakhir tanpa `tools` sehingga model harus menjawab dengan teks.
3. Saat streaming, frame `tool_calls` provider **tidak** diteruskan ke browser; sebagai gantinya API menyisipkan frame `crk.tool` (`running` → `ok`/`error`) yang ditampilkan UI sebagai chip di bawah gelembung jawaban. Hanya ada satu `[DONE]`, di ujung. Tanpa streaming, respons JSON membawa `x_tools` (nama, sukses, durasi).

Tool yang sama juga disajikan ke klien MCP eksternal (Claude Desktop, Claude Code) lewat `/v1/mcp`, dan sebaliknya server MCP eksternal yang didaftarkan admin di **Server MCP** ikut menyumbang tool ke asisten bagi pemegang `ai.mcp.use` — lihat [`MCP.md`](./MCP.md). Mematikan: `ai.tools_enable = false` (Pengaturan → AI) untuk semua, atau `tools: false` pada request. Request **tidak boleh** membawa `tools` sendiri — tool adalah deklarasi modul, bukan input klien. Setiap putaran provider tercatat sebagai satu baris `ai_calls`. Bukti: `modules/AI/test/integration/ai.test.ts` (loop tool stream & non-stream terhadap provider tiruan yang meminta `dummy_ping`) dan `apps/api/test/integration/tools.test.ts` (I-6: 401 tanpa sesi, 403 tanpa izin, isolasi tenant, modul nonaktif, audit).

## Log panggilan (H-9, M-3)

Setiap panggilan dicatat ke `ai_calls` **setelah** respons selesai (`queueMicrotask`), jadi tidak menahan jalur panas: endpoint, model, token in/out/total, latensi, latensi token pertama, status (`ok`/`error`/`cancelled`), biaya estimasi. Job `ai.log_retention` (harian) menghapus baris yang lebih tua dari `ai.log_retention_days`. Halaman **Log AI** (`/m/ai/logs`) memerlukan izin `ai.log.read`.

## Pengembangan tanpa kunci nyata

```bash
bun run ai:mock          # provider tiruan di http://127.0.0.1:4010/v1 — mengecho pesan token demi token
```

Isi `ai.baseurl` dengan URL itu dan `ai.key` dengan nilai apa pun. Proof `bun run proof:m1:docker` memakainya untuk membuktikan gate M5 secara otomatis.

## Kompatibilitas API

Endpoint chat mengikuti bentuk OpenAI (`messages`, `model`, `stream`, `temperature`, `max_tokens`) dan menambah dua field opsional: `conversation_id` untuk persistensi (H-6) dan `tools: boolean` untuk menawarkan tool modul ke model (I-3; baku mengikuti `ai.tools_enable`). Percakapan: `GET/POST /v1/m/ai/conversations`, `GET/PATCH/DELETE /v1/m/ai/conversations/:id`. Profil penyedia: `GET /v1/m/ai/providers/options` (pemilih), `GET/POST /v1/m/ai/providers`, `GET/PUT/DELETE /v1/m/ai/providers/:id`, `POST /v1/m/ai/providers/:id/test` (probe penyedia, memakai model baku), `POST /v1/m/ai/providers/:id/models/test` (probe satu model, body `{ model }`). Analitik: `GET /v1/m/ai/analytics?days=`. Semua tunduk RBAC (`ai.chat.*`, `ai.log.read`, `ai.provider.*`) dan tenancy.
