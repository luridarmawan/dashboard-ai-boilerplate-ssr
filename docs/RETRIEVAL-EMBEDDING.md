# Retrieval Berbasis Embedding — Seleksi Tool & RAG Dokumen

| | |
|---|---|
| **Status** | **Rencana — belum dikerjakan** (dicatat 2026-09-16). Belum ada satu pun kode embedding di repo: `grep -ri embedding` atas `apps/`, `modules/`, `packages/`, `docs/` nihil |
| **Pemilik** | Modul `AI` (`modules/AI/`) + registry tool inti (`apps/api/src/tools.ts`) |
| **Bergantung pada** | `docs/PRD.md` titik perluasan 8 (tools), `docs/AI-Roadmap.md` (provider & endpoint), `docs/MCP.md` (tool eksternal I-4) |
| **Isu pemicu** | Payload definisi tool tumbuh linear terhadap jumlah tool aktif dan dikirim ulang tiap ronde tool-loop. Dengan beberapa server MCP terpasang, satu giliran chat bisa menghabiskan puluhan ribu token hanya untuk mendeskripsikan tool |

## 1. Klarifikasi masalah

Payload tool **tidak** dikirim ke user. Ia dikirim ke provider di `modules/AI/api/routes.ts:797-798` lalu masuk ke body permintaan di `send()` (`:851` untuk `/responses`, `:860` untuk `/chat/completions`). Yang sampai ke browser hanya frame SSE. Jadi yang dioptimasi adalah **biaya token upstream + latensi**, bukan ukuran respons ke klien.

Bentuk biayanya:

```
routes.ts:797   const tools = toolsWanted ? await listTools(caller) : [];
routes.ts:798   const openAiTools = tools.length ? toOpenAiTools(tools, caller.locale) : null;
routes.ts:1006  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++)   // 5 ronde
```

`openAiTools` dihitung **sekali per giliran**, tetapi ikut terkirim **di setiap ronde** (kecuali ronde terakhir, lihat argumen `withTools` pada `callProvider`). Jadi:

```
biaya ≈ jumlah_tool × ukuran_deskriptor × jumlah_ronde
```

### Angka hari ini

| Sumber | Jumlah | Catatan |
|---|---|---|
| Tool inti | 1 | `core.get_current_datetime` — `apps/api/src/core-tools.ts` |
| Tool modul statik | 4 | Dummy 2 + Example 2 — `apps/api/src/generated/tools.ts` |
| Tool MCP eksternal | **tak terbatas** | Semua tool aktif dari semua server MCP tenant, dimuat per request — `modules/AI/api/mcp-tools.ts` (`enabledTools`) |

Deskripsi `core.get_current_datetime` saja 508 karakter (satu locale) ≈ 150–200 token bersama JSON Schema-nya. Statik saat ini ≈ 1k token — belum jadi masalah. Yang meledak adalah tool MCP: 3 server kelas menengah ≈ 60–100 tool ≈ 15–20k token, dikali 4 ronde ≈ **60–80k token per giliran**.

Kesimpulan: ini masalah **skala MCP**, bukan masalah tool statik. Prioritaskan sesuai itu.

## 2. Opsi A — retrieval untuk seleksi tool

**Kompleksitas: sedang-rendah. Perkiraan 2–3 hari.**

### 2.1 Kenapa relatif murah di repo ini

1. **Satu titik sisip.** Ranking diselipkan antara `routes.ts:797` dan `:798`. `listTools()` dan `toOpenAiTools()` di `apps/api/src/tools.ts` **tidak diubah**.
2. **Registry inti harus tetap utuh.** `/v1/tools` (`apps/api/src/domains/tools.ts`) dan `/v1/mcp` wajib tetap melihat daftar penuh — retrieval adalah kebijakan *chat loop*, bukan kebijakan registry. Tempatnya `modules/AI/api/retrieval.ts`.
3. **Tes mengunci daftar tool persis.** Tiga asersi `toEqual` membandingkan daftar apa adanya — `apps/api/test/integration/tools.test.ts:264`, `apps/api/test/integration/mcp.test.ts:217` dan `:301` — di samping sejumlah `toContain` di berkas yang sama. Mengubah keluaran `listTools` akan memerahkan semuanya tanpa alasan.
4. **Tidak ada lubang keamanan.** `callTool()` me-resolve nama **independen** dari apa yang di-*list*. Retrieval yang meleset hanya menurunkan recall; tiga jaminan (modul aktif, permission, validasi skema) plus audit `tool.call` tetap berlaku utuh.
5. **Tidak perlu vector store.** Untuk 50–500 vektor, cosine di JS atas `Float32Array` = mikrodetik. Cache in-process dengan key = hash deskriptor.
6. **Infrastruktur panggilan embedding sudah ada.** `ai_providers` menyimpan `base_url` + `api_key`; `resolveProvider()` (`modules/AI/api/providers.ts:116`) sudah memilih profil. `POST ${baseurl}/embeddings` adalah fetch ~20 baris sepola `send()`.

### 2.2 Yang belum ada dan harus dibuat

- **Probe kemampuan embedding.** `modules/AI/api/probe.ts` hanya menguji chat/stream/tools/reasoning. Model embedding karena itu jadi **setting eksplisit**, bukan hasil deteksi otomatis.
- **Penyimpanan vektor tool MCP.** Tambah satu kolom di `ai_mcp_tools` (`modules/AI/db/tables.ts`), diisi saat discovery/refresh yang sudah ada di `routes.ts:2879`.
- **Migrasi harus aditif** (syarat rollout side-by-side — lihat `docs/DEPLOY.md` dan `deploy/rollout.sh`), dan nama tabel/kolom dijaga pendek: FK 64 karakter pecah dengan `TABLE_PREFIX`.

### 2.3 Berkas yang tersentuh

| Berkas | Perubahan |
|---|---|
| `modules/AI/api/embeddings.ts` | **baru** — `embed(texts, provider)` ke `${baseurl}/embeddings`, fail-open |
| `modules/AI/api/retrieval.ts` | **baru** — cosine, cache vektor, `selectTools(tools, query, budget)` |
| `modules/AI/api/routes.ts` | satu blok di antara `:797`–`:798` |
| `modules/AI/config.ts` | 4 setting (§2.4) |
| `modules/AI/db/tables.ts` | satu kolom vektor pada `ai_mcp_tools` |
| `modules/AI/api/mcp-tools.ts` | isi vektor saat discovery |
| tes | unit cosine/seleksi + integrasi "daftar penuh tetap di `/v1/tools`" |

### 2.4 Setting yang diusulkan

| Kunci | Tipe | Default | Arti |
|---|---|---|---|
| `ai.tool_retrieval_enable` | boolean | `false` | Saklar utama |
| `ai.tool_retrieval_min_tools` | number | `30` | Di bawah ambang ini, kirim semua tool (lihat prompt caching, §2.5) |
| `ai.tool_retrieval_top_k` | number | `20` | Jumlah tool yang disertakan |
| `ai.embedding_model` | string | — | Model embedding; kosong = retrieval mati |

### 2.5 Tiga jebakan nyata

1. **Prompt caching rusak.** Array `tools` adalah prefiks stabil; kalau isinya berubah tiap giliran, cache prefiks provider miss terus. Untuk tenant dengan ≤30 tool, retrieval bisa **lebih mahal** daripada mengirim semuanya. Karena itu `ai.tool_retrieval_min_tools` wajib ada, dan default retrieval-nya mati.
2. **Recall multi-ronde.** Model sering baru tahu butuh tool X setelah membaca hasil tool Y. Mitigasi murah: re-rank tiap ronde memakai teks hasil tool sebelumnya, dan **selalu** sertakan tool inti + tool yang sudah dipanggil di giliran ini.
3. **Latensi + kegagalan.** Satu round-trip embedding sebelum panggilan pertama. Harus **fail-open**: provider embedding mati → kirim daftar penuh. Polanya sudah ada di `listTools` ketika sebuah tool source gagal (`apps/api/src/tools.ts`, `logger.warn('tool: source listing failed')`).

## 3. Opsi B — RAG dokumen

**Kompleksitas: tinggi. Perkiraan 1–2 minggu.** Bedanya dengan opsi A:

- **Tidak ada tipe vektor.** `packages/db/src/descriptor.ts` hanya punya `json`, `text`, `longtext`, `int`, `bigint`, dst. pgvector tidak portabel karena target juga MySQL/MariaDB (`packages/db/src/migrate.ts`: `familyOf`). Praktisnya: simpan vektor base64 di `text` dan hitung similarity di JS — baik untuk ribuan chunk, jelek untuk ratusan ribu. Di titik itu perlu store eksternal, dan itu keputusan arsitektur tersendiri.
- Butuh tabel baru (dokumen, chunk, vektor) dengan nama pendek (batas FK 64 karakter + `TABLE_PREFIX`).
- Butuh pipeline chunking, job ingest (`defineJobs` sudah ada — `modules/AI/jobs.ts`), integrasi `storeUpload()` dari `@app/api/files`, kebijakan retensi, dan UI admin per tenant.
- Butuh tool retrieval sendiri di registry supaya asisten bisa memanggilnya — yang justru menambah satu tool ke payload yang sedang kita coba kecilkan.

## 4. Urutan kerja yang disarankan

Sebelum menyentuh embedding sama sekali:

1. **Budget guard + telemetri.** Hitung perkiraan token `openAiTools` di `routes.ts:798`, catat ke `ai_calls`. Tanpa angka, tidak jelas apakah retrieval menyelesaikan masalah nyata atau masalah hipotetis — tool statik baru 5 buah.
2. **Kurasi per tenant.** `ai_mcp_tools.enabled` sudah ada; admin mematikan tool yang tidak dipakai. Penghematan terbesar, nol kode baru.
3. **Prefilter leksikal (BM25/keyword) sebagai baseline.** Deskripsi tool ditulis dua bahasa dan sangat deskriptif, jadi keyword match sering cukup — sekaligus jadi pembanding untuk membuktikan embedding memang lebih baik.

Baru setelah itu: **Opsi A**. **Opsi B** adalah pekerjaan terpisah dengan justifikasi sendiri, bukan kelanjutan otomatis dari opsi A.

## 5. Gate

- `bun run check` + `bun test` hijau; empat tes yang mengunci daftar tool **tidak boleh** berubah isinya
- `/v1/tools` dan `/v1/mcp` tetap mengembalikan daftar penuh saat retrieval aktif — tes integrasi khusus
- Provider embedding mati → chat tetap jalan dengan daftar tool penuh (uji fail-open)
- Migrasi aditif, terbukti lewat `bun run proof:rollout` (`scripts/ci/rollout-proof.sh`)
