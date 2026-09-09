# AI Roadmap — Capability-Aware Provider & Modern Endpoint

| | |
|---|---|
| **Status** | **F0 selesai** 2026-09-09 (`modules/AI/api/probe.ts`, `POST /providers/:id/test`, mock `/responses`); F1 menunggu keputusan §5.1 |
| **Pemilik** | Modul `AI` (`modules/AI/`) |
| **Bergantung pada** | `docs/PRD.md` §4.5 titik perluasan 1–12, `docs/AI.md` §Ganti provider & Multi-provider (H-10), `docs/ROADMAP.md` §8.6 |
| **Isu pemicu** | Provider saat ini hardcode `POST /chat/completions` (`modules/AI/api/routes.ts:690`), uji koneksi hanya `GET /models` (`modules/AI/api/providers.ts:136`). Belum ada deteksi `/responses`, stream, reasoning, dan tools — admin tidak tahu kemampuan API sebelum chat pertama gagal |

## 1. Ringkasan

Roadmap ini mengubah tombol **Uji koneksi** dari _"apakah URL+key benar"_ menjadi **capability probe**: satu panggilan mengembalikan matriks kemampuan provider sehingga UI bisa:

1. Menandai provider **direkomendasikan** bila mendukung endpoint modern `/responses` + `reasoning`/`tools`
2. Memberi keterangan pada opsi yang tidak didukung provider terpilih — switch `ai.tools_enable` di **Pengaturan → AI** (`modules/AI/config.ts:110`) dan badge di pemilih provider. Catatan: **tidak ada** toggle streaming/tools per-chat hari ini (streaming implisit: dengan JS lewat `./stream`, tanpa JS non-stream), jadi "menonaktifkan toggle di pemilih chat" berarti membangun UI chat baru — di luar lingkup §5.4
3. Memilih endpoint yang benar saat runtime (`/responses` diutamakan, fallback ke `/chat/completions`)

Prinsip: **deteksi sekali di setup, pakai selamanya di chat** — jalur panas tidak menambah latensi.

## 2. Gap hari ini

| Area | Hari ini | Dampak |
|---|---|---|
| Endpoint | `fetch(${baseurl}/chat/completions)` tetap — `modules/AI/api/providers.ts:136` pakai `/models` saja | Provider modern yang hanya expose `/v1/responses` (OpenAI Responses API `input`/`stream`, `reasoning`, `previous_response_id`) → `404` tanpa pesan jelas |
| Stream | Tidak diuji; diasumsikan ada bila `/chat/completions` ada | Provider non-stream (atau proxy yang buffer) membuat UI hanging / error generik |
| Reasoning | Tidak ada kolom/flag; `reasoning_content`/`reasoning_tokens` tidak dibaca | Model reasoning (o3, gpt-5) tidak dimanfaatkan; biaya/token reasoning tidak tercatat |
| Tools | Tidak diuji; `tools` dikirim bila ada tool terdaftar `modules/AI/api/routes.ts:653` | Provider yang menolak `tools`/`tool_calls` (atau butuh `tool_choice`) gagal dengan `400` di chat pertama |

## 3. Matriks kemampuan yang diuji

Satu hasil `capabilities` per provider (disimpan, bukan dihitung tiap request):

Bentuk ini **camelCase**, sama seperti seluruh kontrak API repo ini (`providerView` memetakan
snake_case DB → camelCase kontrak), dan itu pula yang disimpan di kolom JSON:

```json
{
  "endpoints": { "responses": true, "chatCompletions": true },
  "stream": { "supported": true, "sse": true, "responsesStream": true },
  "reasoning": { "supported": true, "param": "reasoning|reasoning_effort", "via": "responses" },
  "tools": { "supported": true, "functionCalling": true, "via": "responses|chat_completions" },
  "modelsTested": ["gpt-4o-mini", "o3-mini"],
  "preferredEndpoint": "responses"
}
```

Tipe otoritatifnya `Capabilities` di `modules/AI/api/probe.ts`; kolom DB tetap snake_case
(`capabilities`, `preferred_endpoint`).

**Aturan prioritas (sesuai permintaan):**

1. `preferred_endpoint = "responses"` bila `endpoints.responses == true` — selalu diutamakan
2. Provider dengan `endpoints.responses && (reasoning.supported || tools.supported)` diberi badge **Direkomendasikan** dan diurutkan paling atas di `GET /v1/m/ai/providers/options` dan halaman `/m/ai/providers`.

   **Sorting itu HANYA di lapisan view — jangan sentuh `enabledProviders`.** Fungsi itu (`modules/AI/api/providers.ts:31`) mengurutkan `is_default` lalu `code`, dan `resolveProvider` memakai `profiles[0]` sebagai penyedia baku tenant (`providers.ts:79`). Kalau urutan rekomendasi dimasukkan ke sana, penyedia yang melayani chat **berubah sendiri** ketika pemanggil tidak menyebut `code`/`providerId` — melanggar kriteria §7.6. Ikuti pola yang sudah ada: `GET /providers` menyortir salinannya sendiri di handler (`routes.ts:1462`); `/providers/options` (`routes.ts:1428`) harus menyortir salinannya sendiri juga.
3. Chat runtime: `resolveProvider` (`modules/AI/api/providers.ts:67`) mengembalikan `endpoint` yang dipakai; `callProvider` memilih URL & payload sesuai endpoint

## 4. Strategi probing — minimal, aman, deterministik

Deteksi harus **murah** (< 20 token), **idempoten**, dan **tidak menulis riwayat**.

### 4.1 Urutan probe (total < 4 detik, timeout per langkah 3 dtk)

```
1. GET /models  (yang ada sekarang) → INFORMATIF saja: mengisi `models_tested`, TIDAK memveto probe.
   401/403 → stop (auth memang salah). 404/405 → lanjut ke langkah 2: proxy
   Anthropic-compat & sebagian deployment Azure sah tidak punya `/models`.
2. POST {baseUrl}/responses  dengan body minimal:
     { model: defaultModel, input: "ping", max_output_tokens: 8, stream: false }
   → 200 + field `output`/`response`  → endpoints.responses = true
   → 404/405 → responses tidak ada → fallback chat
   → 400 "unknown field input" → bukan Responses API
3. POST {baseUrl}/chat/completions (fallback/konfirmasi):
     { model, messages:[{role:"user",content:"ping"}], max_tokens: 8, stream:false }
   → 200 → chat_completions = true
4. Stream probe (hanya bila langkah 2 atau 3 ok):
   a) POST .../responses  { ..., stream:true, max_output_tokens: 8 } → baca 1 chunk SSE
   b) POST .../chat/completions { ..., stream:true, stream_options:{include_usage:true}} → baca 1 chunk
   → ada `data:` dan bukan `error` → stream.supported = true
5. Reasoning probe (bila responses ok):
     POST .../responses { ..., reasoning:{effort:"low"} atau reasoning_effort:"low" }
   → 200 dan response mengandung `reasoning`/`reasoning_tokens`/`output[reasoning]` → supported
   → 400 "unknown field reasoning" → tidak didukung (tidak error kritis)
6. Tools probe:
   - Responses: POST .../responses { ..., tools:[{type:"function", name:"probe_noop", description:"noop", parameters:{type:"object",properties:{}}}], tool_choice:"auto" }
     → 200 dan model membalas `tool_calls`/`function_call` atau minimal tidak 400 → supported
   - Chat: POST .../chat/completions { ..., tools:[{type:"function", function:{name:"probe_noop"}}] }
     → cek `choices[0].message.tool_calls` atau error `tools not supported`
```

Semua body memakai `max_output_tokens: 8 / max_tokens: 8` untuk meminimalkan biaya. Probe tidak memakai `conversation_id` / `attachments` / `context` sehingga tidak menyentuh tabel `ai_*`.

**`temperature: 0` hanya di langkah 3 (chat).** Model reasoning (o1/o3) menolak `temperature` selain nilai baku, jadi langkah 2 dan 5 dikirim tanpa `temperature`.

**Langkah 5 satu-satunya yang tidak benar-benar gratis.** Token reasoning ditagih dan tidak dibatasi `max_output_tokens` seperti output biasa, jadi anggaran "< 20 token" tidak berlaku di sana: pakai `max_output_tokens: 16` dan perlakukan `400`/`422` sebagai "tidak didukung" **tanpa retry**.

### 4.2 Heuristik tanpa probe (optimistik)

Bila provider menolak probe berbayar (mis. butuh billing), fallback heuristik dari `GET /models` + `model` pattern:

- Model `o1*`, `o3*`, `gpt-5*` → `reasoning: likely`
- Daftar model mengandung `responses` di docs → tampilkan `belum diuji — kemungkinan mendukung`

Tapi badge **Direkomendasikan** hanya muncul bila probe eksplisit berhasil.

## 5. Perubahan yang dibutuhkan

### 5.1 DB — `modules/AI/db/tables.ts:10`

Tambah kolom di `ai_providers`. Migrasi berikutnya adalah **`0022`** — `0021_flat_impossible_man.sql` yang terakhir. Tabel modul tidak punya direktori migrasi sendiri: `bun db:generate` menulis ke `packages/db/migrations/{mysql,pg}` yang **dibagi** dengan core. Migrasi wajib **aditif**, karena rollout side-by-side (`--no-recreate`) menjalankan image lama dan baru bersamaan:

```ts
capabilities: col.json().nullable(), // matriks di §3
capabilities_at: col.datetime().nullable(),
preferred_endpoint: col.identifier(16).nullable(), // 'responses' | 'chat_completions'
last_probe_error: col.text().nullable(),
last_probe_ms: col.int().nullable(),
```

Indeks tidak perlu; pembacaan via `providerView`. (`col.json()` memang tersedia — `packages/db/src/descriptor.ts:152`.)

**`capabilities` tidak boleh difilter atau disortir di SQL.** Kontrak kolom menyatakannya eksplisit: "Never query inside JSON in portable code — MariaDB stores it as longtext" (`packages/db/src/descriptor.ts:151`). Karena itu `preferred_endpoint` sengaja kolom skalar terpisah — semua penyaringan/pengurutan berbasis kemampuan dilakukan di JS setelah baris dibaca, bukan lewat `WHERE capabilities->…`.

**`ai_calls` — kolom baru, JANGAN pakai `endpoint` yang sudah ada.** `ai_calls.endpoint` (`col.identifier(64)`) sudah dipakai sebagai label rute API **lokal**: nilainya `'chat.completions'` (`modules/AI/api/routes.ts:726`), dibaca halaman Log (`routes.ts:1379`), dan termasuk kontrak filter log (`routes.ts:1403`). Menulis `responses` ke sana mendefinisikan ulang kolom yang sudah dibaca dua konsumen. Tambah kolom terpisah di migrasi yang sama:

```ts
// ai_calls
upstream_endpoint: col.identifier(16).nullable(), // 'responses' | 'chat_completions'
```

**Lubang yang harus diputuskan sebelum F1: penyedia legacy tidak punya baris untuk ditulisi.** Bila tenant belum punya profil, `resolveProvider` jatuh ke `ai.baseurl`/`ai.key`/`ai.model` (`providers.ts:96`–`118`) — penyedia implisit `docs/AI.md:15`, yaitu justru kasus single-tenant yang paling umum. Kolom di atas semuanya milik `ai_providers`, dan §9 menolak probe per request, jadi apa adanya jalur itu **tidak akan pernah memakai `/responses`**. Halaman *Pengaturan → AI* juga tidak punya tombol Uji koneksi — halaman itu digenerate dari `modules/AI/config.ts` (12 key `ai.*`, tak satu pun soal endpoint). Pilih satu:

1. **Tambah setting `ai.preferred_endpoint`** (`auto` | `responses` | `chat_completions`, baku `auto`) di `config.ts`; `auto` mencoba `/responses` sekali lalu fallback pada 404/405 dan mengingatnya per-proses — *disarankan*
2. `bun run ai:test` yang menulis `ai.preferred_endpoint` — bertentangan dengan §10.5 ("tidak menulis ke DB"), perlu pengecualian eksplisit
3. Nyatakan jalur legacy **chat-only selamanya** dan tulis itu di kriteria §7.6

Opsi 1 dan 2 menambah key di `config.ts`, artinya `bun run modules:sync` menulis ulang `modules.json` — hasilnya wajib round-trip byte-identik.

### 5.2 API — `modules/AI/api/providers.ts` + `modules/AI/api/routes.ts`

**`providers.ts`**

- `export type Capabilities` (§3)
- `probeCapabilities(baseUrl, key, defaultModel, signal): Promise<Capabilities & {ms, error}>` — jalankan urutan §4.1 sekuensial dengan `AbortSignal` per langkah
- `resolveProvider` kembalikan `endpoint: 'responses' | 'chat_completions'` + `capabilities` untuk dipakai chat

**`routes.ts`**

- `POST /providers/:id/test` (`routes.ts:1670`) — panggil `probeCapabilities` (bukan hanya `GET /models`), simpan `capabilities`/`preferred_endpoint`/`capabilities_at`, audit `ai.provider.test` dengan ringkasan capability
- `GET /providers/:id` & `GET /providers` & `providerView` (`routes.ts:349`) — sertakan `capabilities`, `preferredEndpoint`, `capabilitiesAt`
- **Skema respons ikut tumbuh, dan Elysia memvalidasi keluaran:** `ProviderView` (`routes.ts:325`) dan skema `/test` yang ditulis inline (`routes.ts:1707`) harus ditambah field baru — field yang lupa ditambah jadi **500**, bukan lolos diam-diam
- **`capabilitiesAt` adalah tanggal baru:** Eden Treaty mengubah string date-like menjadi `Date` di sisi web, jadi loader butuh normalisasi seperti `lastTestedAt` hari ini (`web/routes/providers/+page.svelte:39`). Uji integrasi memakai raw `fetch` sehingga **tidak** menangkap ini
- `POST /chat/completions` (`routes.ts:460`) — `callProvider(endpoint, stream, withTools)`:

```ts
const url = p.endpoint === 'responses'
  ? `${p.baseurl}/responses`
  : `${p.baseurl}/chat/completions`;
const body = p.endpoint === 'responses'
  ? { model, input: toResponsesInput(convo), stream, reasoning: ..., tools: toResponsesTools(...) }
  : { model, messages: convo, stream, tools: openAiTools };
```

- Tambah helper `toResponsesInput(messages)`. Ini **bagian terberat F2**, bukan pemetaan sepele:
  - system → `instructions`; user/assistant teks → `input[]`
  - **Tool round-trip (I-3):** Responses API tidak punya role `tool`. Loop sekarang mendorong `{ role: 'tool', tool_call_id, content }` (`routes.ts:792`) dan giliran assistant membawa `tool_calls` (`ProviderMessage`, `routes.ts:69`) — tiap round harus jadi item `function_call` / `function_call_output` berkunci `call_id`
  - **Lampiran (H-11):** `{ type: 'image_url', image_url: { url } }` (`ContentPart`, `routes.ts:66`; dirakit di `routes.ts:680`) menjadi `input_image`
- Normalisasi SSE di satu tempat `parseResponsesChunk` (`response.output_text.delta` → frame yang sudah ada). **Sisi web tidak perlu berubah:** API tidak mem-proxy frame upstream, ia menyusun frame `choices[0].delta` sendiri (`routes.ts:874`, `981`–`1009`) dan kedua klien membaca bentuk itu (`web/routes/chat/+page.svelte`, `web/widgets/FloatingChat.svelte:152`) — cukup alirkan hasil parse ke penyusun frame yang sama, keluarannya tetap `text/event-stream`

### 5.3 Mock provider — `scripts/ai-mock-provider.ts:23`

Mock hari ini mengembalikan `404` untuk **segala** hal yang bukan `POST /v1/chat/completions` (`scripts/ai-mock-provider.ts:23`) — termasuk `GET /v1/models`. Selama itu belum ada, gate F0 ("curl ke mock"), F4 (`proof:m5` pakai mock) dan §10.5 (`ai:test` menarget mock) **tidak mungkin lolos**. Tambahkan:

- `GET /v1/models` — daftar id model tiruan (dipakai langkah 1 §4.1)
- `POST /v1/responses` — echo + SSE (`response.output_text.delta`) + `tools`/`reasoning` dummy, agar `bun run ai:mock` membuktikan kedua endpoint di CI. `GET /responses` tetap tidak ada — hanya `POST`.

Tiga mode di mock yang sama (chat-only / responses-only / keduanya), mis. lewat `MOCK_ENDPOINTS=chat|responses|both`, berguna untuk membuktikan §7.1–§7.3 dengan tangan.

**Sudah diimplementasikan** (F0): `GET /v1/models`, `POST /v1/responses` (non-stream + SSE `response.output_text.delta` + `reasoning`/`function_call` dummy), dan `MOCK_ENDPOINTS=chat|responses|both`.

**Posisi mock ini: dev manual + `bun run ai:test` — BUKAN CI.** Uji integrasi memalsukan upstream *in-process* dengan `Bun.serve`-nya sendiri, dan itu yang harus diperluas di F4:

- `modules/AI/test/integration/providers.test.ts:55` `mockProvider()` — sudah melayani `/models` + `/chat/completions`, persis bentuk yang dibutuhkan
- `modules/AI/test/integration/ai.test.ts:77` — fake stream + tool round-trip

**Jebakan:** fake di `ai.test.ts` mengabaikan pathname — apa pun yang bukan `/models` dijawab sebagai chat (`ai.test.ts:77`–`95`). Menambah `/responses` tanpa cabang `url.pathname` eksplisit membuat request bentuk Responses dijawab bentuk chat, dan **tesnya lolos padahal salah**.

### 5.4 Web — `modules/AI/web/routes/providers/`

- `+page.svelte` — tabel tambah kolom **Kemampuan**: badge `responses`, `stream`, `reasoning`, `tools` (hijau/abu) + badge **Direkomendasikan** bila `preferred_endpoint === 'responses' && (reasoning || tools)`
- `[id]/+page.svelte:55` — card Uji koneksi tampilkan matriks, latensi per langkah, dan rekomendasi; tombol tetap `POST ?/test`
- `+page.server.ts` & `[id]/+page.server.ts` — teruskan `capabilities` ke UI. `[id]/+page.server.ts:60` mengetik payload uji secara kaku sebagai `{ ok, error, models, ms }` dan harus diperlebar ke matriks §3
- `new/+page.svelte` — tidak ada teks yang diubah di berkas ini; baris 17 adalah `FormBuilder`. Hint-nya ada di `ai.providers.new_hint` (i18n) → lihat §5.5

### 5.5 i18n — `modules/AI/i18n/*.json`

Tambah key:

```
ai.providers.capabilities  ai.providers.preferred  ai.providers.recommended
ai.providers.probe_responses  ai.providers.probe_stream  ai.providers.probe_reasoning  ai.providers.probe_tools
```

**Key lama yang jadi salah** — semuanya menjelaskan uji satu-panggilan yang lama dan harus ditulis ulang di `id.json` **dan** `en.json`:

- `ai.providers.test_hint` (`i18n/id.json:71`) — berbunyi persis "Memanggil GET /models di penyedia…"
- `ai.providers.tested_ok` (`:72`) dan `ai.providers.tested_models_hint` (`:73`)
- `ai.providers.new_hint` (`:54`) — tambahkan "Utamakan penyedia yang mendukung `/responses` + reasoning/tools" (ini butir §5.4 yang lama, teksnya memang di sini)

## 6. Fase & estimasi

| Fase | Isi | Gate |
|---|---|---|
| ~~**F0 — Probe tanpa DB**~~ **SELESAI 2026-09-09** | `modules/AI/api/probe.ts` (murni, tanpa `@app/api/services`/`@core/db`) + `POST /providers/:id/test` kembalikan matriks tanpa menyimpannya; mock dapat `GET /v1/models`, `POST /v1/responses`, `MOCK_ENDPOINTS` | Terbukti: `modules/AI/test/probe.test.ts` (11 kasus, unit) + matriks di `providers.test.ts`; mock tiga mode diklasifikasi benar. **Proxy nyata belum diuji** — butuh key |
| **F1 — Persist & UI (2–3 hari)** | Migrasi `capabilities` + `preferred_endpoint`, `providerView`, halaman Providers tampilkan badge & sorting | Halaman `/m/ai/providers` urutkan direkomendasikan di atas; badge hijau/abu sesuai hasil |
| **F2 — Chat runtime dual-endpoint (5–8 hari)** | `resolveProvider` + `callProvider` bercabang `/responses` vs `/chat/completions`, `parseResponsesChunk`, `toResponsesInput/Tools` **termasuk `function_call`/`function_call_output` (I-3) dan `input_image` (H-11)**, log `ai_calls.upstream_endpoint` | Chat streaming & non-stream lulus di kedua endpoint (mock + provider nyata); `ai_calls.provider` + `upstream_endpoint` tercatat; sisi web tidak disentuh |
| **F3 — Reasoning/tools deep (2–3 hari)** | Reasoning param mapping (`reasoning_effort` vs `reasoning`), `reasoning_tokens` → `tokensOut` + biaya, `tool_choice` mapping | Test integrasi: model reasoning mengembalikan `reasoning_tokens`; tools 5 round tetap jalan di `/responses` |
| **F4 — Polish & gate CI (1–2 hari)** | Perluas fake `Bun.serve` in-process: `providers.test.ts:55` (3 mode — chat-only, responses-only, keduanya; badge & preferred) dan `ai.test.ts:77` (cabang `/responses` + stream + tool round-trip, dengan cek `url.pathname`). `scripts/ai-mock-provider.ts` untuk dev manual & `ai:test`, tidak dipakai CI | `INTEGRATION=1 bun test modules/AI/test/integration/` hijau tanpa key nyata. **Bukan** `proof:m5:gate4` — skrip itu gate "modul AI dicabut, aplikasi tetap ter-build tanpa jejak AI" (`scripts/ci/m5-gate4.sh`) dan tidak menyentuh provider; `proof:m5:gate1`–`gate3` tidak ada |

Total **~3 minggu** untuk 1 dev (12–20 hari kerja, termasuk CLI §10.5; paralel dengan P1 lain). F0 bisa di-merge tanpa F2 (probe dulu, pakai nanti).

### 6.1 Catatan pelaksanaan F0 (2026-09-09)

- **Sebagian F4 terpaksa maju.** Begitu `POST /test` memanggil probe, ia mem-POST bentuk Responses (`input`, tanpa `messages`) ke `/responses`; fake in-process di `providers.test.ts` yang tadinya menganggap **setiap** POST sebagai chat langsung melempar di `body.messages.at`, memutus koneksi, dan menggagalkan 4 dari 6 tes. Fake itu kini sadar-pathname dan chat-only secara sengaja. **`ai.test.ts` belum disentuh** — ia tidak memanggil `/test`, jadi belum kena; F4 tetap harus memperbaikinya sebelum menambah `/responses` di sana.
- Lalu-lintas probe dijaga keluar dari `seen` di fake (penanda: `max_tokens === 8` + satu pesan `"ping"`). `tools` **bukan** penanda — chat sungguhan pun mengirim `tools`.
- Probe membatalkan reader SSE setelah frame pertama (ada tesnya: 200 frame tidak pernah habis terbaca).
- Anggaran waktu: timeout 3 dtk per langkah **plus** `budgetMs` 15 dtk untuk seluruh rangkaian. Klaim §4.1 "total < 4 detik" hanya berlaku pada provider sehat; provider mati/lambat memakai ~9 dtk (3 langkah × 3 dtk) sebelum menyerah.
- Probe yang dibatalkan mengembalikan hasil biasa (`error: 'probe dibatalkan'`), bukan exception — supaya route dan CLI tidak perlu masing-masing menangkapnya.

## 7. Kriteria terima

1. Admin membuat provider A (`baseUrl` responses-only) dan B (`chat-only`); **A** ber-badge **Direkomendasikan** dan di urutan pertama
2. `POST /v1/m/ai/providers/:id/test` mengembalikan `capabilities` + `preferred_endpoint`; `GET /v1/m/ai/providers` menyertakannya
3. Chat ke provider `responses-only` berhasil stream & non-stream; chat ke `chat-only` tetap berhasil (fallback)
4. Bila `capabilities` provider `false`: switch `ai.tools_enable` di **Pengaturan → AI** diberi keterangan "tidak didukung penyedia terpilih", dan pemilih provider di chat menampilkan badge kemampuan. Toggle reasoning/tools **per-chat** tidak dijanjikan di sini — UI-nya belum ada (§1)
5. Biaya & token reasoning tercatat benar di `ai_calls` dan `Analitik AI`
6. Tanpa `capabilities` (provider lama) → perilaku lama utuh (chat via `/chat/completions`), dan penyedia baku tenant tidak bergeser: urutan `enabledProviders` tetap `is_default` → `code` (§3 no. 2)
7. Penyedia legacy *Pengaturan → AI* berperilaku sesuai opsi yang dipilih di §5.1 (baku: `ai.preferred_endpoint = auto`)

## 8. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Provider mengembalikan 400 untuk `max_output_tokens` kecil | Coba `max_tokens` / `max_completion_tokens`; toleransi 400 → anggap endpoint ada |
| Model reasoning menolak `temperature` selain nilai baku (o1/o3) | Kirim `temperature: 0` hanya di langkah 3 (chat); langkah 2 dan 5 tanpa `temperature` (§4.1) |
| Sorting rekomendasi menggeser penyedia baku tenant | Sorting hanya di handler view; `enabledProviders` tidak diubah (§3 no. 2) — dijaga tes `providers.test.ts` |
| Probe stream terus ditagih setelah chunk pertama | Setelah 1 chunk terbaca, `reader.cancel()` + abort `AbortController`-nya, jangan hanya `break` dari loop |
| Probe berbayar walau 8 token | Timeout & `max_output_tokens` minimal; tampilkan heuristik bila ditolak 402/429 |
| SSE Responses format beda vendor (Anthropic compat, Azure) | Normalisasi di satu tempat `parseResponsesChunk`; fallback ke `chat` bila parse gagal |
| Breaking chat saat dual-endpoint | Lebih kecil dari dugaan: frame SSE keluar disusun API sendiri, jadi sisi web tidak berubah (§5.2). Tetap pakai feature flag `preferred_endpoint` per provider + fallback otomatis ke `chat_completions` bila Responses 404/405 |

## 9. Alternatif yang tidak diambil

- **Dua field `baseUrl` terpisah** — menambah kompleksitas form; satu `baseUrl` + deteksi cukup (prefiks `/v1` sama)
- **Probe tiap request chat** — menambah latensi & biaya; probe hanya di setup
- **Hapus `/chat/completions` sekaligus** — banyak proxy kompatibel belum implement `/responses`; dual support wajib

## 10. CLI `bun run ai:test` — uji koneksi tanpa browser

**Tujuan:** satu perintah untuk membuktikan _seluruh rantai bootstrap_ sebelum masuk UI — env, Settings global, dan tiap tenant — dengan matriks yang sama dengan tombol **Uji koneksi** (`probeCapabilities` §4.1). Dipakai operator di VPS (`docker compose run --rm api bun run ai:test`) maupun developer lokal.

### 10.1 Sumber yang diuji (berurutan, yang ada saja)

| # | Sumber | Asal | Kapan ada |
|---|---|---|---|
| 1 | **Default env** | `AI_API_BASE_URL` / `AI_API_KEY` / `AI_MODEL` dari `packages/config/src/index.ts:150` | Selalu (bootstrap E-6) — bahkan bila DB belum ada / belum ada tenant |
| 2 | **Settings global** | `configurations` dengan `client_id IS NULL` (`settings.get(null, 'ai.*')`) — yang diedit di `Pengaturan → AI` dengan `?scope=global` | Bila superadmin pernah menyimpan `ai.baseurl`/`ai.key`/`ai.model` global |
| 3 | **Per tenant** | `settings.get(clientId, 'ai.*')` per baris `clients` + profil `ai_providers` per tenant (H-10) | Bila tenant punya override Settings atau profil `ai_providers` (kode, baseUrl, model baku) |

Urutan resolusi tiap tenant sama dengan runtime `modules/AI/api/providers.ts:67` (`env → global → tenant → profil baku`); CLI menampilkan **nilai efektif** yang benar-benar akan dipakai chat.

### 10.2 Kontrak perintah

```bash
bun run ai:test                          # semua sumber yang ada
bun run ai:test -- --tenant acme         # hanya tenant `acme` (id / slug / kode)
bun run ai:test -- --tenant all --json   # JSON untuk CI
bun run ai:test -- --base-url https://api.openai.com/v1 --model gpt-4o-mini  # override ad-hoc (tanpa tulis .env)
```

`package.json:17`

```json
"ai:test": "bun run scripts/ai-test.ts",
"ai:mock": "bun run scripts/ai-mock-provider.ts"
```

`scripts/ai-test.ts` (baru, ~180 baris, reuse `probeCapabilities` dari `modules/AI/api/providers.ts:136`):

- `loadEnv()` → sumber #1; `settings.get(null, ...)` → #2; `select clients` + `select ai_providers` → #3 (capai DB lewat `packages/db`, tidak lewat HTTP)
- Untuk tiap sumber: panggil `probeCapabilities(baseUrl, key, model)` — urutan §4.1 yang sama (GET /models, POST /responses, POST /chat/completions, stream/reasoning/tools)
- Tulis `preferred_endpoint` + badge **Direkomendasikan** dengan aturan §3 (responses + reasoning/tools diutamakan)

### 10.3 Output

**Manusia (default):**

```
AI test — 3 sumber, 2 tenant

#  Sumber              Base URL                     Model          Key  Endpoint   Stream  Reasoning  Tools  Rekom  ms  Status
1  env (bootstrap)     https://ai-router.carik.id/v1  sumo/qwen3.8-flash  ●  responses  ✓  ✓  ✓  ★  412  ok
2  settings:global     https://api.openai.com/v1       gpt-4o-mini        ●  chat       ✓  —  ✓  —  298  ok
3  tenant:acme (profil openai) https://api.openai.com/v1   gpt-4o           ●  responses  ✓  ✓  ✓  ★  341  ok
   tenant:acme (settings) — ditimpa profil, tidak dipakai
4  tenant:demo         (tidak ada konfigurasi — fallback ke env)
```

**JSON (`--json`):**

```json
{ "sources": [{ "source": "env", "baseUrl": "...", "model": "...", "keySet": true, "capabilities": {...}, "preferred": "responses", "ok": true, "ms": 412 }] }
```

`--verbose` menambah latensi per langkah (`GET /models 98ms, POST /responses 120ms …`) dan `error` lengkap bila gagal (401/404/timeout).

### 10.4 Exit code & CI

- `0` bila **minimal satu sumber ok** dan bila ada sumber yang gagal → tetap `0` tapi baris `Status` = `error` + pesan actionable (mis. `401 — API key ditolak → periksa AI_API_KEY`).
- `1` bila **semua** sumber gagal, atau salah satu flag gate diminta — dua flag terpisah, jangan digabung:
  - `--strict` → gagal bila **ada** sumber yang probe-nya gagal (auth / network / endpoint)
  - `--require-responses` → gagal bila ada sumber tanpa `endpoints.responses`
- `deploy/upgrade.sh` dan `api preflight` (Q-13) bisa memanggilnya sebagai pemeriksaan tambahan sebelum rollout.

### 10.5 Implementasi (estimasi 1–2 hari, sebelum F2)

- `scripts/ai-test.ts` impor `probeCapabilities` (ekstrak dari `providers.ts` ke `modules/AI/api/probe.ts` agar dipakai route + CLI). **`probe.ts` tidak boleh mengimpor `@app/api/services` maupun `@core/db`** — `providers.ts:1` menarik `settings` dari service yang dirangkai *lazy* oleh app API, dan itu justru yang tidak dimiliki skrip mandiri. Tanda tangannya `(baseUrl, key, model, signal)`, tidak lebih; pembacaan Settings/DB tinggal di `ai-test.ts`
- CLI membaca `clients` + `ai_providers`, jadi kena jebakan `.env` membocorkan `TABLE_PREFIX` ke proses anak — bersihkan `childEnv` seperti skrip drizzle-kit
- Tidak menulis `capabilities` ke DB — hanya baca + probe; tombol **Uji koneksi** di UI tetap yang menulis `ai_providers.capabilities`
- `ai.mock` tetap terpisah; `ai:test` bisa menarget mock: `AI_API_BASE_URL=http://127.0.0.1:4010/v1 bun run ai:test`

## 11. Rujukan implementasi

- `docs/AI.md:15` Pengaturan → AI sebagai penyedia implisit; `docs/AI.md:29` multi-provider H-10
- `modules/AI/api/providers.ts:136` `probeProvider` saat ini (hanya `GET /models`)
- `modules/AI/api/routes.ts:460` `POST /chat/completions` (proxy)
- `modules/AI/api/routes.ts:1670` `POST /providers/:id/test`
- `modules/AI/db/tables.ts:10` `ai_providers`
- `scripts/ai-mock-provider.ts:23` mock chat-only (404 untuk apa pun selain `POST /v1/chat/completions` — tanpa `GET /models`)
- `packages/config/src/index.ts:150` `AI_API_*` bootstrap (E-6)
- `apps/api/src/services.ts` `settings.get(clientId, key)` — sumber Settings per tenant/global
- `modules/AI/api/routes.ts:726` `ai_calls.endpoint = 'chat.completions'` (label rute lokal — bukan endpoint upstream); dibaca `routes.ts:1379`, kontrak filter `routes.ts:1403`
- `modules/AI/api/routes.ts:792` giliran `role: 'tool'`; `routes.ts:66` `ContentPart` (`image_url`); `routes.ts:874`/`981`–`1009` penyusun frame SSE keluar
- `modules/AI/config.ts:110` switch `ai.tools_enable` (satu-satunya kendali tools di UI); `config.ts:18`–`136` 12 key `ai.*` yang menghasilkan halaman Pengaturan → AI
- `modules/AI/api/providers.ts:31` `enabledProviders` (urutan `is_default` → `code`; `resolveProvider` memakai `profiles[0]`); `providers.ts:96`–`118` jalur legacy `ai.*`
- `modules/AI/api/routes.ts:325` `ProviderView`, `:341` `ProviderOption`, `:349` `providerView`, `:1707` skema respons `/test` (inline)
- `modules/AI/test/integration/providers.test.ts:55` & `ai.test.ts:77` fake upstream in-process (`Bun.serve`) — yang dipakai CI
- `scripts/ci/m5-gate4.sh` gate "modul AI dicabut" — tidak berhubungan dengan provider
- `packages/db/migrations/mysql/0021_flat_impossible_man.sql` migrasi terakhir; `packages/db/src/descriptor.ts:152` `col.json()`
