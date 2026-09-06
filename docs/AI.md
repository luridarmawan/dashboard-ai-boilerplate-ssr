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
| `ai.max_tokens`, `ai.price_*_per_mtok`, `ai.log_retention_days` | Batas keluaran, estimasi biaya, retensi log (M-3) |

Tanpa API key, permintaan dijawab **422** dengan alasan `no_api_key` dan tautan ke Pengaturan — bukan galat generik (H-4).

## Streaming end-to-end (H-3)

`POST /v1/m/ai/chat/completions` dengan `stream: true` meneruskan byte SSE provider apa adanya: **provider → API → SvelteKit (`/m/ai/chat/stream`) → UI**. Pembatalan mengalir balik: menutup tab atau menekan *Berhenti* membatalkan request browser → SvelteKit membatalkan request ke API → API membatalkan request ke provider; panggilan dicatat dengan status `cancelled`.

Tanpa JavaScript, form chat tetap bekerja: jawaban diambil utuh lalu halaman dirender ulang dengan riwayat.

## Log panggilan (H-9, M-3)

Setiap panggilan dicatat ke `ai_calls` **setelah** respons selesai (`queueMicrotask`), jadi tidak menahan jalur panas: endpoint, model, token in/out/total, latensi, latensi token pertama, status (`ok`/`error`/`cancelled`), biaya estimasi. Job `ai.log_retention` (harian) menghapus baris yang lebih tua dari `ai.log_retention_days`. Halaman **Log AI** (`/m/ai/logs`) memerlukan izin `ai.log.read`.

## Pengembangan tanpa kunci nyata

```bash
bun run ai:mock          # provider tiruan di http://127.0.0.1:4010/v1 — mengecho pesan token demi token
```

Isi `ai.baseurl` dengan URL itu dan `ai.key` dengan nilai apa pun. Proof `bun run proof:m1:docker` memakainya untuk membuktikan gate M5 secara otomatis.

## Kompatibilitas API

Endpoint chat mengikuti bentuk OpenAI (`messages`, `model`, `stream`, `temperature`, `max_tokens`) dan menambah satu field opsional `conversation_id` untuk persistensi (H-6). Percakapan: `GET/POST /v1/m/ai/conversations`, `GET/PATCH/DELETE /v1/m/ai/conversations/:id`. Semua tunduk RBAC (`ai.chat.*`, `ai.log.read`) dan tenancy.
