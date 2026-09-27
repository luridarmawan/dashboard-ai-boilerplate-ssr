# Service & Worker: strategi eksekusi pekerjaan panjang

> Status: **catatan arsitektur (RFC awal)** — belum menjadi keputusan PRD. Berkas ini merinci strategi menjalankan pekerjaan lama (job menit-panjang hingga agent AI) di luar event loop API, di lingkungan multi-user/multi-tenant.

## 1. Masalah

- API berjalan sebagai **satu proses Bun dengan satu thread JS** (`apps/api/src/serve.ts:23`). Handler berat CPU akan memblokir event loop dan ikut memperlambat seluruh request (lihat `docs/JOBS-QUEUE.md`).
- Job queue yang ada saat ini memproses maksimal 20 baris **berurutan** per pass, dengan lease = timeout + 30 dtk. Job yang benar-benar menunggu 10 menit di dalam handler berisiko lease-nya kedaluwarsa dan **dieksekusi dobel** oleh instance lain.
- Kebutuhan baru (generate video AI, menjalankan AI agent seperti Claude Code/OpenCode/OpenClaw) berdurasi menit hingga jam dan tidak boleh mengganggu jalur request user lain.

## 2. Prinsip umum: "job singkat, kerja di tempat lain"

Queue adalah **orkestrator**, bukan tempat menunggu:

1. **Pecah per event, jangan pernah menunggu di dalam job.**
   - Pola submit/poll: job `submit` (kirim request, simpan external ID ke tabel, selesai < 1 dtk) → status "processing" di tabel khusus → job scheduler berkala (30–60 dtk) cek status yang belum selesai → job `finalize` saat hasil masuk.
   - Lebih baik lagi: **webhook callback** dari platform eksternal (infrastruktur webhook sudah ada, `docs/WEBHOOKS.md`) — nol polling.
2. **Kerja berat di child process / container terpisah**, bukan di proses API. Agent dan render CPU adalah I/O-heavy atau proses terpisah; API hanya mengelola state.
3. **Multi-user**: gunakan kolom `priority` (pisahkan job cepat vs panjang), `client_id` untuk **kuota per tenant** (cek kuota di route sebelum enqueue, bukan di worker), dan progress UX via SSE (pola streaming modul AI) atau polling ringan.

## 3. Dua kategori pekerjaan panjang

### A. Pekerjaan di pihak ketiga (AI video API: Replicate, fal.ai, Runway, dst)

App hanya orkestrator: kirim request → terima job ID → tunggu → ambil hasil.

- Job 1: `submit` — kirim request, simpan external ID, selesai.
- Job 2 (scheduler, tiap 30–60 dtk): poll status yang belum selesai; atau register webhook endpoint.
- Hasil disimpan via file/S3 adapter (fitur unggah berkas sudah ada).
- Upaya utama: tabel `video_jobs` (atau generik `external_jobs`) + job submit + poll/webhook + progress UI.

### B. Menjalankan AI agent (Claude Code, OpenCode, OpenClaw, dll)

Agent itu **interaktif, lama, streaming, dan mengeksekusi kode** — risikonya berbeda dari render video. Lihat `docs/SANDBOX.md` untuk isolasi eksekusinya.

Tiga pola integrasi:

| Pola | Mekanisme | Cocok untuk |
|---|---|---|
| A. Headless CLI per task | job queue spawn `claude -p "<task>" --output-format stream-json` di workspace khusus; state antar-langkah via `--resume <session>` | tugas otonom satu arah (review PR, tulis migrasi) — **mulai dari sini** |
| B. SDK | Agent SDK (hooks, tool permission, interrupt mid-run) | butuh kontrol/hentikan agent di tengah jalan; mengikat per vendor |
| C. Agent service panjang hidup | worker container + kanal SSE interaktif | chat real-time dengan agent — bangun hanya setelah Pola A terbukti |

Aturan main agent:

- **Satu job = satu langkah** ("user kirim pesan" = enqueue `agent.turn`); crash aman karena retry → resume session.
- **State percakapan di tabel `agent_sessions`**, job queue hanya referensikan ID — jangan simpan state di payload job.
- **Multi-vendor lewat adapter**: kontrak `AgentProvider` (start task, stream events, cancel, resume), event dinormalisasi (`thinking/tool_use/text/done`). Provider terdaftar sebagai adapter, bukan if-else per vendor.
- **Timeout & biaya**: max durasi, max token per turn, `maxAttempts` rendah (2 — retry agent mahal), log cost per job untuk billing tenant.

## 4. Worker terpisah: `QUEUE_ONLY=1`

Desain klaim-baris di database (`UPDATE … WHERE status='pending'`, `affectedRows=1` menang) sudah aman untuk multi-instance tanpa Redis. Maka:

- Gunakan **image Docker yang sama** dengan entrypoint/flag berbeda: `QUEUE_ONLY=1` → skip `serve()`, hanya menjalankan loop worker (`workQueueOnce`).
- Jalankan 1–2 container worker terpisah dari container API (mis. `docker compose --scale api=N` atau service `worker` tersendiri). HTTP tidak pernah terganggu job berat.
- Untuk CPU-sangat-berat lokal (ffmpeg, konversi besar): worker mem-spawn proses/container per job (lihat `docs/SANDBOX.md`), tetap bukan di event loop.
- Scheduler hanya aktif jika `SCHEDULER_ENABLED`; nudge enqueue tetap jalan — worker memanfaatkan keduanya.

## 5. Gambar arsitektur target

```
[API event loop] --enqueue(job singkat)--> [queue_jobs DB]
                                               |
[worker container QUEUE_ONLY=1] --claim--> spawn proses/container job
        |   stream stdout (stream-json)          |
        +--> SSE progress ke user <— tabel event/poll ringan
        +--> hasil/artefak --> file adapter / S3 / diff PR
```

## 6. Urutan implementasi yang disarankan

1. Pola A agent headless (sandbox sederhana, tanpa UI interaktif) + tabel `agent_sessions`/`agent_events`.
2. Progress SSE + resume session.
3. Worker `QUEUE_ONLY=1` sebagai service compose terpisah.
4. Adapter provider (OpenCode/OpenClaw) dan mode interaktif (Pola C) terakhir.
