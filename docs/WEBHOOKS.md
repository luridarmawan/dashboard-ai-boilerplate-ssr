# Webhook keluar (PRD J-5)

| | |
|---|---|
| **Halaman** | **Webhook keluar** (`/webhooks`) — izin `webhook.read` melihat, `webhook.manage` mengelola |
| **API** | `GET/POST /v1/webhooks`, `GET/PUT/DELETE /v1/webhooks/:id`, `POST /v1/webhooks/:id/test`, `POST /v1/webhooks/:id/rotate-secret`, `POST /v1/webhooks/:id/deliveries/:deliveryId/retry`, `GET /v1/webhooks/events` |
| **Data** | tabel `webhooks` dan `webhook_deliveries` per tenant (migrasi 0013) |

## Apa yang dikirim

Setiap **event inti** yang menyangkut sebuah tenant — `user.created`, `user.deleted`, `tenant.switched`, `config.saved`, `module.toggled`, `notification.created` — diantrekan untuk semua webhook aktif tenant itu yang berlangganan event tersebut (atau `*`). Event tanpa tenant (`system.ping`, konfigurasi global) tidak dikirim: webhook milik tenant. Pengiriman berjalan di luar jalur request: baris antrean dibuat saat event terjadi, lalu dikirim segera oleh proses yang sama dan disapu ulang tiap menit oleh job `core.webhooks.deliver`.

Permintaan yang diterima tujuan:

```http
POST <url>
Content-Type: application/json
User-Agent: dab-webhooks/1.0
X-DAB-Event: user.created
X-DAB-Delivery: 01a0…            # id pengiriman, unik — pakai untuk idempotensi
X-DAB-Timestamp: 1788860000      # detik Unix saat dikirim
X-DAB-Signature: sha256=…        # HMAC-SHA256(secret, "<timestamp>.<body>")

{"id":"01a0…","event":"user.created","occurredAt":"2026-09-08T09:00:00.000Z","clientId":"…","requestId":"…","data":{"userId":"…","clientId":"…"}}
```

## Verifikasi di penerima

Hitung `HMAC-SHA256(secret, timestamp + "." + bodyMentah)` dan bandingkan dengan `X-DAB-Signature` (setelah awalan `sha256=`) memakai perbandingan waktu-konstan; tolak bila `X-DAB-Timestamp` lebih tua dari 5 menit. Secret diperlihatkan **sekali** saat webhook dibuat (dan saat **Ganti secret**); yang tersimpan hanya di tabel `webhooks` dan tidak pernah dikembalikan API. Contoh Node/Bun:

```ts
const expected = 'sha256=' + createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return new Response('bad signature', { status: 401 });
```

Balas **2xx dalam 10 detik**. Balasan lain atau galat jaringan memicu percobaan ulang setelah 1 menit, 5 menit, 30 menit, 2 jam, dan 12 jam; setelah itu status `failed`, dan admin bisa menekan **Coba lagi** di halaman webhook (pengiriman apa pun yang belum `delivered`). Setiap percobaan tercatat di `webhook_deliveries`: status, jumlah percobaan, kode respons, galat terakhir, jadwal berikutnya. Riwayat yang sudah `delivered`/`failed` dipangkas job retensi setelah **Pengaturan → Log & retensi → Retensi riwayat webhook** (baku 30 hari); metrik `webhook_deliveries_total{status}` tersedia di `/metrics`.

## Yang tidak dilakukan

- Event modul: bus inti hanya membawa event core; modul yang ingin mengirim webhook untuk kejadiannya sendiri memanggil `enqueueEvent` dari `@app/api/webhooks` dengan nama event yang terdaftar, atau menunggu daftar event diperluas.
- Webhook masuk (menerima dari luar) — di luar J-5.
- Tanpa tanda tangan atau tanpa HTTPS tetap diizinkan (URL `http://` untuk pengembangan); pakai HTTPS di produksi.

Bukti: `apps/api/test/integration/webhooks.test.ts` — penerima in-process memverifikasi tanda tangan; isolasi tenant; jadwal retry sampai `failed`; retry manual; ping uji; rotasi secret; nonaktif dan hapus.
