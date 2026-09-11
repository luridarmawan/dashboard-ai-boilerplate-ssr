# Antrean pekerjaan ad-hoc (PRD P2)

| | |
|---|---|
| **Status** | Selesai (ROADMAP M7 #10) — infrastruktur siap, belum ada pemanggil produksi |
| **Tabel** | `queue_jobs` (`packages/db/schema/queue_jobs.def.ts`, migrasi 0018) |
| **Implementasi** | `apps/api/src/queue.ts` — `registerTask()`, `enqueue()`, `workQueueOnce()`, `retryJob()` |
| **Worker** | `core.queue.work` tiap 10 dtk + nudge 50 ms setelah `enqueue` (`apps/api/src/runtime.ts:96`) |
| **Admin** | `GET /v1/queue`, `POST /v1/queue/:id/retry`, `DELETE /v1/queue/:id` (`apps/api/src/domains/queue.ts`) + halaman `/queue` (`apps/web/src/routes/(app)/queue/`) — izin `queue.read` / `queue.manage` |
| **Bukti** | `apps/api/test/queue.test.ts`, `apps/api/test/integration/queue.test.ts` |

> Sumber kebenaran: [`docs/PRD.md`](./PRD.md) tabel prioritas **P2** (`PRD.md:534`) dan [`docs/MODULES.md`](./MODULES.md) § Antrean pekerjaan dari modul (`MODULES.md:436`). Dokumen ini ringkasan operasionalnya.

## 1. Untuk apa

Pekerjaan yang terjadi **karena sesuatu** — impor CSV, render laporan/PDF, kirim massal, panggilan pihak ketiga yang lambat — tidak boleh dijalankan di dalam request dan bukan pula job berkala. Antrean ini adalah jalan keluarnya: request hanya menulis satu baris, pulang, dan worker mengerjakannya di luar jalur request dengan retry dan dead-letter.

Beda dengan dua antrean lain yang polanya mirip tapi terpisah:

| Antrean | Tabel | Worker | Untuk |
|---|---|---|---|
| **Job ad-hoc (dokumen ini)** | `queue_jobs` | `core.queue.work` (10 dtk) | Pekerjaan umum modul/core, payload bebas |
| **Outbox email** (FR-J) | `outbox_emails` | `core.outbox.deliver` (1 m) | `enqueueEmail()` di `packages/mail/src/index.ts:40` |
| **Webhook keluar** (J-5) | `webhook_deliveries` | `core.webhooks.deliver` (1 m) | `enqueueEvent()` di `apps/api/src/webhooks.ts:72` — lihat [`WEBHOOKS.md`](./WEBHOOKS.md) |

Job berkala modul (`jobs.ts` / `defineJobs`, G-18) juga berbeda: ia berjalan **sekali per interval** tanpa payload, sedangkan antrean ini berjalan **sekali per baris** karena ada kejadian.

## 2. Cara kerja

```
registerTask  →  enqueue  →  queue_jobs (pending)  →  workQueueOnce claim  →  handler  →  done / pending(retry) / dead
                                              ↑ nudge 50ms + tiap 10 dtk
```

1. **Daftar handler saat boot.** Setiap instance memanggil `registerTask()` yang sama, jadi instance mana pun boleh mengklaim baris mana pun (`apps/api/src/queue.ts:83`).
2. **Tulis baris dari route.** `enqueue()` menulis `name, payload, priority, run_at, dedupe_key, max_attempts` (`apps/api/src/queue.ts:107`). `dedupeKey` menolak enqueue kedua selagi ada baris `pending/running` dengan kunci sama.
3. **Klaim dan jalankan.** `workQueueOnce()` (`apps/api/src/queue.ts:201`) memulihkan lease kedaluwarsa lalu mengklaim baris jatuh tempo (`run_at <= now`) urut `priority DESC, run_at ASC, created_at ASC` dengan **satu `UPDATE ... WHERE status='pending'` bersyarat** — di `--scale api=3` setiap baris tetap dieksekusi sekali (`apps/api/src/queue.ts:260`).

## 3. Kontrak task

```ts
import { enqueue, registerTask } from '@app/api/queue';

// sekali, saat plugin API modul dibuat (setiap instance mendaftarkan set yang sama)
registerTask('billing.invoice.render', async (payload, ctx) => {
  const { invoiceId } = payload as { invoiceId: string };
  // ctx: id, name, attempt, maxAttempts, clientId, requestId, instanceId, signal
  return { pdf: await renderInvoice(invoiceId, ctx.signal) };
}, {
  maxAttempts: 5,        // baku 5
  timeoutMs: 60_000,     // baku 60_000, lease = timeout + 30_000
  description: { id: 'Render PDF tagihan', en: 'Render invoice PDF' },
});

// di route: tulis satu baris, request langsung selesai
await enqueue('billing.invoice.render', { invoiceId }, {
  clientId,              // informasional, untuk filter di /queue
  priority: 10,          // -100..100, lebih besar dulu
  delayMs: 0,            // atau runAt: Date
  dedupeKey: `invoice:${invoiceId}`,
  maxAttempts: 5,
  requestId,
});
```

Aturan nama: `NAME_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/` (`apps/api/src/queue.ts:68`) — wajib `<ns>.<task>` (`core.*` atau `<modul>.*`). Daftar terdaftar bisa dilihat di `GET /v1/queue → tasks` dan halaman `/queue`.

```ts
// util lain
import { listTasks, unregisterTask, backoffMs, setQueueInstanceId } from '@app/api/queue';
listTasks();                 // RegisteredTask[] urut nama
unregisterTask('billing.x'); // untuk test / unload modul
backoffMs(attempt);          // 10s, 60s, 300s, 1800s, 7200s
retryJob(id);                // dead/pending → pending, attempts=0 (dipakai POST /v1/queue/:id/retry)
```

## 4. Siklus hidup baris

```
pending → running → done
        ↘ pending (retry, run_at = now + backoff) → ... → dead (setelah maxAttempts)
running --lease habis--> pending/dead (dipulihkan pass berikutnya)
```

* **Sukses:** `status='done'`, `result` disimpan (JSON, dipotong 4000 karakter, `safeResult()` `apps/api/src/queue.ts:174`).
* **Gagal/timeout:** `last_error` diisi, `run_at` dijadwalkan ulang dengan `BACKOFF_S = [10, 60, 300, 1800, 7200]` detik (`apps/api/src/queue.ts:63`). Setelah `attempt >= max_attempts` → `dead`.
* **Lease kedaluwarsa:** worker yang mati meninggalkan `running` lewat `locked_until`; pass berikutnya mengembalikan ke `pending` (atau `dead`) (`apps/api/src/queue.ts:205`).

Kolom penting `queue_jobs` (`packages/db/schema/queue_jobs.def.ts:10`): `name, payload(json), client_id, priority, status(pending|running|done|dead), attempts, max_attempts, run_at, locked_by, locked_until, last_error, dedupe_key, request_id, started_at, finished_at, result(json)`. Tabel **global** (`tenant: false`) dengan `client_id` informasional; worker bersifat process-level.

## 5. Event siklus hidup

Setiap percobaan menerbitkan dua event inti di bus (G-17), jadi modul bisa mendengarnya lewat `hooks.ts` dan baris ber-`clientId` otomatis sampai ke webhook keluar tenant itu (J-5, [`WEBHOOKS.md`](./WEBHOOKS.md)):

| Event | Kapan | Payload |
|---|---|---|
| `job.started` | klaim `pending → running` berhasil | `jobId, name, clientId, attempt, maxAttempts` |
| `job.finished` | percobaan itu berakhir | di atas + `status` (`done` \| `retried` \| `dead`), `durationMs`, `error` |

* **Sekali per percobaan, bukan per baris.** Job yang gagal dua kali lalu sukses menerbitkan tiga pasang `started`/`finished` (`retried`, `retried`, `done`).
* **Lease kedaluwarsa** (worker mati): pass yang memulihkan baris menerbitkan `job.finished` dengan `error: "lease habis …"` dan `status` `retried`/`dead` — `job.started`-nya sudah terbit di instance yang hilang, dan pendengar tidak boleh menunggu akhir yang tak pernah datang.
* **`clientId` opsional.** Baris tanpa tenant (pemeliharaan inti) tetap menerbitkan event, tapi `enqueueEvent` tidak mengirimnya ke webhook mana pun — webhook milik tenant.
* Job berkala (`defineJobs`, G-18) tidak memakai event ini; status jalannya ada di `scheduler_runs` dan metrik `job_runs_total`.

## 6. Operasional

* **Skala horizontal:** tanpa Redis. Klaim kondisional + `locked_by/locked_until` membuat `--scale api=N` aman.
* **Nudge:** `nudgeQueue()` (`apps/api/src/queue.ts:385`) single-flight per proses, `setTimeout 50ms → workQueueOnce()`, jadi enqueue yang jatuh tempo dieksekusi dalam <1 detik tanpa menunggu tick 10 dtk.
* **Halaman `/queue`:** strip hitungan per status (diagregasi database dengan `GROUP BY`, bukan ditarik ke memori), daftar task yang dikenal build ini, dan **paginasi `?page=`** — 50 baris per halaman, tautan biasa yang tetap jalan tanpa JavaScript. Filter halaman hanya `?status=`; `name` dan `limit` (maks 200) ada di API tapi belum dipakai halaman. Respons `GET /v1/queue` menyertakan `counts` per status dan `meta { page, limit, total, totalPages }`.
* **Aksi:** **Ulangi** (retry) muncul untuk baris `dead`, **Hapus** untuk semua kecuali `running`. Keduanya teraudit (`queue.retry`, `queue.delete`) dan scope tenant: superadmin melihat semua, lainnya `client_id = aktif OR NULL` (`apps/api/src/domains/queue.ts:71`).
* **Retensi:** baris `done/dead` dipangkas job `core.logs.retention` sesuai `logs.queue_retention_days`.
* **Metrik:** `queue_jobs_total{name,status}` (`enqueued|done|retried|dead`) dan `queue_job_duration_seconds{name}` di `GET /metrics` (`apps/api/src/queue.ts:70`).

## 7. Apakah sudah dipakai

**Belum ada pemanggil produksi.** `grep` `registerTask|enqueue` di `modules/` tidak menghasilkan pemanggil (hanya `controller.enqueue` untuk SSE di `modules/AI/api/routes.ts:1020`). Satu-satunya pemanggil nyata adalah test:

* `apps/api/test/queue.test.ts:2` — validasi nama & duplikasi registrasi
* `apps/api/test/integration/queue.test.ts:97` — `enqueue` menolak task tak dikenal, prioritas, `dedupeKey`, retry, timeout, lease

Contoh di `docs/MODULES.md:444` (`billing.invoice.render`) adalah ilustrasi kontrak, bukan implementasi. Modul `AI`/`Example`/`Dummy` memakai `defineJobs` (job berkala) bukan antrean ini.

## 8. Kapan memakai apa

* **Perlu payload & dipicu kejadian** (impor, render, kirim massal) → antrean ad-hoc ini.
* **Perlu berjalan tiap interval tanpa payload** (sapu harian, pengingat) → `jobs.ts` / `defineJobs` (`modules/AI/jobs.ts`).
* **Kirim email** → `enqueueEmail()` (outbox).
* **Kirim webhook** → `enqueueEvent()` — event inti otomatis, event modul manual.

## 9. Rujukan

* Implementasi: `apps/api/src/queue.ts`, `apps/api/src/runtime.ts:96`, `packages/db/schema/queue_jobs.def.ts`
* Admin: `apps/api/src/domains/queue.ts`, `apps/web/src/routes/(app)/queue/+page.server.ts`
* Kontrak modul: `docs/MODULES.md` § Antrean pekerjaan dari modul, `docs/ROADMAP.md` #10
* PRD: P2 queue pekerjaan ad-hoc
