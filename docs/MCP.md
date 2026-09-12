# MCP & Token API

| | |
|---|---|
| **Status** | MCP **server** (I-1, I-2, I-3, I-6) dan MCP **client** (I-4, I-5) tersedia — FR-I lengkap. Transport: **HTTP / Streamable HTTP saja** (keputusan 2026-09-08; klien juga menerima SSE lama), lihat bagian akhir |
| **Endpoint** | `POST /v1/mcp` — MCP *Streamable HTTP* memakai SDK resmi `@modelcontextprotocol/sdk` (I-1), stateless, respons JSON |
| **Autentikasi** | `Authorization: Bearer <token API>` (PRD A-4) — dibuat di **Profil → Token API**; sesi cookie juga diterima (dengan CSRF) |
| **Isi** | `tools/list` & `tools/call` dari registry tool core (titik perluasan 8, [`MODULES.md` §3](./MODULES.md)), `resources/read crk://me`, `prompts/get dashboard_context` |

## Mengapa ini bukan pintu belakang (I-6)

MCP server adalah **kulit tipis** di atas registry tool yang sama dengan yang dipakai chat AI dan `GET/POST /v1/tools` (`apps/api/src/tools.ts`). Tidak ada jalur ke `run()` modul selain lewat registry itu, sehingga klien MCP hanya bisa melakukan apa yang bisa dilakukan user-nya di dasbor:

| Jaminan | Cara |
|---|---|
| Tanpa token/sesi → **401** sebelum JSON-RPC dibaca | `beforeHandle` di `/v1/mcp`; token yang dicabut atau kedaluwarsa diperiksa di **setiap** request (tanpa cache) |
| Tenant tunggal | Token membawa `client_id` (baku: tenant default user). `X-Client-ID` boleh mengganti hanya bila user anggotanya (superadmin: tenant hidup mana pun) — selainnya `403 tenant_forbidden` |
| Izin user, dipersempit scope | `tools/list` hanya memuat tool yang izinnya dipegang; `tools/call` menolak selainnya. Scope token adalah **langit-langit**: `dummy.note.read` saja berarti hanya tool berizin itu (dan tool tanpa izin) yang terlihat |
| Modul nonaktif per tenant → tool hilang | Sama seperti route modul (G-8) |
| Argumen divalidasi, hasil dibatasi | Skema TypeBox tool; galat kembali sebagai `isError: true`, bukan kegagalan transport |
| Teraudit | Setiap `tools/call` menulis `audit_log` (`tool.call`) di tenant tempat ia berjalan (M-2) |

Bukti: `apps/api/test/integration/mcp.test.ts` — klien SDK resmi melakukan `initialize → tools/list → tools/call → resources/read → prompts/get`; 401 tanpa bearer; token member hanya melihat `dummy_ping`; isolasi tenant lewat `X-Client-ID`; pencabutan token langsung memutus akses.

## Menyambungkan klien

1. Masuk ke dasbor → **Profil → Token API** → *Buat token*. Salin token; ia hanya ditampilkan sekali. Pilih masa berlaku, dan bila perlu batasi izin (mis. `example.product.read`). Kartu ini hanya muncul untuk user yang punya izin **`ai.mcp.use`** ("use" pada *Server MCP eksternal*, atau `ai.mcp.manage`/wildcard yang mencakupnya; superadmin selalu); tanpa izin itu kedua aksinya dijawab 403 di server, bukan hanya disembunyikan.
2. Daftarkan server di klien MCP Anda. URL-nya `https://<domain>/v1/mcp` (Caddy meneruskan `/v1/*` ke API, lihat [`DEPLOY.md`](./DEPLOY.md)):

```bash
# Claude Code
claude mcp add --transport http dashboard https://app.contoh.id/v1/mcp \
  --header "Authorization: Bearer <token>"

# Uji cepat tanpa klien: JSON-RPC langsung
curl -s https://app.contoh.id/v1/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Accept: application/json, text/event-stream" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Klien yang hanya mendukung konfigurasi JSON (Claude Desktop, dll.) memakai bentuk `{"type":"http","url":"https://app.contoh.id/v1/mcp","headers":{"Authorization":"Bearer <token>"}}` atau, bila klien belum mendukung *Streamable HTTP* dengan header, sebuah *bridge* stdio seperti `mcp-remote`.

Nama tool di kawat adalah `<ns>_<nama>` (mis. `example_list_products`), karena OpenAI dan MCP tidak mengizinkan titik; registry menerima kedua bentuk.

## Token API (A-4)

| Endpoint | Arti |
|---|---|
| `GET /v1/tokens` | Token milik saya — tanpa rahasia |
| `POST /v1/tokens` `{ name, expiresInDays?, scopes?, clientId? }` | Buat token; **balasan satu-satunya yang memuat `token`** (201). Hanya dari sesi cookie — token tidak bisa membuat token |
| `DELETE /v1/tokens/:id` | Cabut. Berlaku pada request berikutnya di semua instance |

Endpointnya sendiri tetap milik setiap user yang punya sesi (token adalah miliknya sendiri, A-4); yang dibatasi izin `ai.mcp.use` adalah **kartu Token API di halaman Profil** beserta kedua aksinya — inti tidak bergantung pada izin milik modul. Yang disimpan hanya hash SHA-256 (seperti sesi). `scopes` harus izin yang terdaftar (`user.read`, `example.product.read`, …) dan hanya bisa **mempersempit** izin user; `clientId` harus tenant yang boleh dimasuki user. Aksi khusus sesi — logout, ganti tenant, membuat token — dijawab `403` dengan `reason: session_only` bila dipanggil dengan bearer. Request bearer tidak membawa cookie, jadi plugin CSRF mengecualikannya secara struktural (bukan per route).

## MCP client — server eksternal untuk asisten (I-4, I-5)

Modul AI juga bisa **menjadi klien** MCP: admin tenant mendaftarkan server MCP eksternal, dan tool-nya ikut ditawarkan ke asisten (dan ke `/v1/tools` serta MCP server di atas) untuk user yang berizin.

| | |
|---|---|
| **UI** | **Asisten AI → Server MCP** (`/m/ai/mcps`): tambah server (nama, kode, transport, URL, header rahasia), **Uji & muat tool**, aktif/nonaktif, hapus. Butuh `ai.mcp.read` untuk melihat, `ai.mcp.manage` untuk mengubah |
| **API** | `GET/POST /v1/m/ai/mcps` · `GET/PUT/DELETE /v1/m/ai/mcps/:id` · `POST /v1/m/ai/mcps/:id/test` (terhubung, memuat `tools/list`, menyimpannya ke `ai_mcp_tools`, mencatat status) |
| **Transport** | `http` (Streamable HTTP, spesifikasi terkini) dan `sse` (lama). **Bukan `stdio`**: API berjalan sebagai satu binary di kontainer dan tidak boleh menjalankan proses sembarang atas permintaan admin tenant; `websocket` menunggu dukungan SDK yang stabil |
| **Tabel** | `ai_mcps` (per tenant, kode unik per tenant, header disimpan sebagai rahasia dan selalu ditampilkan `***`) dan `ai_mcp_tools` (tool hasil discovery, skema argumen mentah dari server) |
| **Nama tool** | `ext_<kode>__<tool>` di kawat (`ext.<kode>__<tool>` di registry); karakter yang tidak sah pada nama tool jauh diganti `_` |
| **Siapa yang boleh** | Tool eksternal ditawarkan ke asisten hanya bagi user berizin **`ai.mcp.use`**, di tenant yang mendaftarkan server itu. Ini izin terpisah dari `ai.chat.create` — memberi asisten akses ke sistem luar adalah keputusan admin, bukan bawaan |

Cara kerjanya: `modules/AI/api/mcp-tools.ts` mendaftarkan sebuah **tool source** ke registry core (`registerToolSource`). Registry memanggilnya per request untuk melengkapi daftar tool statis dari `api/tools.ts`, sehingga izin, tenant, dan audit (`tool.call`) berlaku persis sama. Argumen tool eksternal **tidak** divalidasi di sini (skemanya milik server jauh; ia yang memvalidasi). Setiap panggilan membuka koneksi baru dan menutupnya — tidak ada state antar-instance, dan server yang mati terasa pada panggilan berikutnya, bukan mengendap di cache. Batas waktu 20 detik per operasi.

Bukti: `modules/AI/test/integration/mcp-client.test.ts` — server MCP nyata (SDK resmi) di dalam proses yang menuntut header `x-api-key`: registrasi → uji → tool tersimpan dengan nama kawat yang sah; tool muncul di `/v1/tools` hanya bagi pemegang `ai.mcp.use` dan hanya di tenant pemilik; `POST /v1/tools/call` meneruskan ke server jauh dengan header rahasia; loop chat AI memanggil tool eksternal seperti tool modul; nonaktif menyembunyikan, hapus melupakan.

## Yang sengaja tidak ada

- Transport `stdio` dan `websocket` untuk klien — **tidak direncanakan**. `websocket` bukan transport resmi spesifikasi MCP dan hampir tidak ada server yang menyajikannya. `stdio` berarti API menjalankan proses pilihan admin tenant di server (eksekusi kode jarak jauh yang disengaja) di dalam image yang tidak punya Node/Python. Pola yang dipakai: jalankan server stdio di proses terpisah di balik *bridge* seperti `mcp-proxy` atau `supergateway` yang mengekspos Streamable HTTP, lalu daftarkan URL-nya seperti server HTTP biasa. Buka kembali hanya bila ada pemakai nyata yang tidak bisa memakai bridge.
- Sesi MCP *stateful* dan notifikasi `tools/list_changed` di server kami: mode stateless tidak butuh state antar-instance (`--scale api=3`) dan tool hanya berubah saat deploy atau saat admin menekan **Uji & muat tool**.
- Cache koneksi ke server eksternal: satu handshake `initialize` per panggilan adalah harga yang dibayar untuk tidak punya state; kalau kelak terasa, tambahkan cache ber-TTL per instance, bukan Redis.
