# MQTT (titik perluasan 18)

| | |
|---|---|
| **Status** | Tersedia sejak 2026-10-11 (ROADMAP §8 butir 67). Klien **inti**, satu per proses API; modul berlangganan lewat `mqtt.ts` dan menerbitkan lewat `publish()` |
| **Sakelar** | **Pengaturan → MQTT** (lingkup global, superadmin): `mqtt.enabled`, URL broker, kredensial, versi protokol, awalan client id, awalan topik, jembatan event inti. Kolom kosong jatuh ke `MQTT_*` di `.env`. Berlaku **tanpa restart** |
| **Untuk modul** | `defineMqtt` dari `@core/module-kit` · `publish()`, `mqttState()` dari `@app/api/mqtt` |
| **Broker** | Apa pun yang berbicara MQTT 3.1.1 atau 5; `docker compose --profile mqtt` menjalankan **Eclipse Mosquitto 2** (dev: anonim di `127.0.0.1:31883`; prod: satu akun dari `MQTT_USERNAME`/`MQTT_PASSWORD`, hanya di jaringan stack) |
| **Bukti** | `apps/api/test/mqtt.test.ts` (broker in-process `aedes`), `packages/module-kit/test/mqtt.test.ts`, `scripts/ci/mqtt-smoke.ts` (Mosquitto nyata, MQTT 5, dua instance, satu pesan → satu handler), `apps/api/test/integration/{config,example}.test.ts` |

## Mengapa klien inti, bukan modul

Perangkat IoT, gateway RTLS, AGV, Traccar, dan sistem pabrik umumnya hanya berbicara MQTT. Kalau setiap modul membawa klien sendiri, satu deployment punya N koneksi, N cara mengatur kredensial, dan N cara yang berbeda untuk gagal — dan tidak satu pun yang bisa dimatikan dari satu tempat. Core memegang **satu** klien per proses, modul hanya menyatakan topik dan handler. Ini pola yang sama dengan SMTP (`@core/mail`) dan antrean (`@app/api/queue`): infrastruktur milik core, kebijakan milik modul.

## Alur

```
Pengaturan → MQTT (global)  ─┐
MQTT_* di .env (bootstrap)  ─┴─► mqttFor() ─► MqttService (satu per proses API)
                                               │  connect / reconnect / keep-alive (mqtt.js)
                                               │  subscribe: $share/<awalan>/<awalan topik>/<filter modul>
                                               ▼
   broker ◄──── publish('…')  ◄──── modul   handler modul ◄──── pesan (topik tanpa awalan, params wildcard)
      ▲
      └──── events/<nama event>  ◄──── jembatan event inti (mqtt.publish_events)
```

- **Satu pesan, satu instance.** Langganan modul baku `shared: true` → di broker menjadi `$share/<awalan client id>/<topik>` (MQTT 5). Dengan `--scale api=3` broker membagi pesan ke satu instance saja — janji yang sama dengan penjadwal (G-18), tanpa lock di database. Di broker MQTT 3.1.1 (`mqtt.protocol_version = 4`) langganan dipasang polos dan **setiap instance menerima setiap pesan**; core mencatat peringatan sekali.
- **Awalan topik** (`mqtt.topic_prefix`, mis. `acme/prod`) adalah namespace deployment di broker bersama: ditambahkan ke setiap langganan dan publish, dan **dihilangkan** sebelum pesan sampai ke modul. Modul menulis `site/+/pos`, bukan `acme/prod/site/+/pos`.
- **Berlaku tanpa restart.** Instance yang menyimpan section memuat ulang klien seketika (event `config.saved`); instance lain membaca ulang section tiap 30 detik. Konfigurasi yang tidak berubah tidak memutus koneksi.
- **Handler yang melempar** dicatat (`mqtt: handler failed`) dan dihitung (`mqtt_handler_runs_total{status="failed"}`), tidak pernah menjatuhkan klien atau menghalangi langganan lain (aturan G-7).
- **Mode pemeliharaan** tidak menghentikan handler — perangkat tidak login. Modul yang ingin menahan aksinya membaca `maintenanceState()` sendiri.

## Untuk modul

### `mqtt.ts` — berlangganan

```ts
import { defineMqtt } from '@core/module-kit';

export default defineMqtt('Twin', [
  {
    name: 'twin.positions',            // wajib "twin.*"
    topic: 'site/+/asset/+/pos',       // filter MQTT; tanpa $share/ (core yang menambahkannya)
    qos: 1,                            // baku 1
    shared: true,                      // baku true; false = setiap instance menerima
    description: { id: 'Posisi aset dari gateway', en: 'Asset positions from gateways' },
    handler: async (message, ctx) => {
      const [siteId, assetId] = message.params;   // tangkapan wildcard, urut
      const pos = message.json<{ t: number; x: number; y: number }>();
      if (!pos) return;                            // payload rusak: buang, jangan lempar
      await enqueue('twin.position.store', { siteId, assetId, pos });
      await ctx.publish('ack/' + assetId, 'ok');   // publish lewat klien yang sama
    },
  },
]);
```

`message`: `topic` (tanpa awalan), `payload` (`Uint8Array`), `qos`, `retain`, `params`, `text()`, `json()` (null bila bukan JSON). `ctx`: `subscription`, `module`, `instanceId`, `receivedAt`, `signal` (abort saat shutdown), `publish()`.

Handler berjalan **tanpa request** di instance yang menerima pesan. Buat pendek: validasi, satu baris, `enqueue()` atau `notify()`; kerja berat masuk antrean. Handler tidak membawa tenant — bawa di topik (`example/<clientId>/inquiries`) atau petakan dari isi pesan, lalu pakai `forTenant()`.

### `publish()` — menerbitkan

```ts
import { mqttState, publish } from '@app/api/mqtt';

const r = await publish('billing/invoice.paid', JSON.stringify({ id }), { qos: 1, retain: false });
// r = { ok: true } | { ok: false, reason: 'disabled' | 'disconnected' | 'invalid_topic' | 'failed', error? }
```

Tidak pernah melempar: kebanyakan pemanggil memperlakukan MQTT sebagai opsional, jadi hasilnya nilai. `mqttState()` memberi `{ enabled, configured, connected, url, protocolVersion, topicPrefix, subscriptions, lastError }` untuk halaman modul yang ingin menampilkan status.

### Yang diperiksa `modules:sync`

Nama langganan ber-namespace, filter topik sah (`+` satu level penuh, `#` hanya di akhir, tanpa `$share/`), handler fungsi, dan tidak ada nama yang bentrok antar modul. Nama langganan tampil sebagai chip di halaman Modul.

## Jembatan event inti

`mqtt.publish_events = true` menerbitkan setiap event inti (`user.created`, `job.finished`, …, lihat `CORE_EVENTS`) sebagai JSON ke `events/<nama event>`:

```json
{ "event": "job.finished", "occurredAt": "2026-10-11T03:00:00.000Z", "instanceId": "api-1:42", "requestId": "…", "data": { … } }
```

Ini padanan webhook keluar (J-5) untuk sistem yang mendengarkan MQTT — tanpa tanda tangan, karena broker yang mengautentikasi; batasi dengan ACL siapa yang boleh berlangganan `events/#`.

## Operasional

| Hal | Di mana |
|---|---|
| Uji koneksi | **Pengaturan → MQTT → Uji koneksi** (`POST /v1/configuration/mqtt/test`, izin `config.edit`, 20×/10 menit per akun): connect → subscribe topik uji → publish → tunggu gema, lalu status klien instance ini. Teraudit `mqtt.test` |
| Readiness | `/v1/ready` memuat `checks.mqtt` **hanya** bila klien diaktifkan; tidak tersambung = tidak siap (rollout menunggu, Caddy tetap melayani lewat `/v1/health`) |
| Preflight | `mqtt`: `warn` bila `MQTT_URL` diisi tapi broker tidak menjawab, `skip` bila kosong — API tetap start, klien terus mencoba |
| Metrik | `mqtt_connected`, `mqtt_messages_total{direction,status}`, `mqtt_handler_runs_total{subscription,status}`, `mqtt_handler_duration_seconds` |
| Log | `mqtt: connected` / `connection closed` / `handler failed` / `switched off`, JSON seperti log lain |
| Broker dev | `docker compose --profile mqtt up -d` → `mqtt://127.0.0.1:31883`, anonim (`deploy/mosquitto/mosquitto.dev.conf`) |
| Broker prod | `dc --profile mqtt up -d` → `mqtt://mosquitto:1883` di jaringan stack, akun dari `MQTT_USERNAME`/`MQTT_PASSWORD` (`deploy/mosquitto/mosquitto.conf`). Perangkat di luar host butuh route TCP yang Anda buka sendiri (`ports:` atau Caddy layer4) — tidak dibuka secara bawaan |
| Bukti CI | job `mqtt-smoke`: Mosquitto nyata, MQTT 5, 60 pesan ke dua instance → 60 handler, 0 duplikat |

## Yang sengaja tidak ada

- **Browser → broker langsung.** Browser tidak pernah memegang kredensial broker; data ke browser lewat SSE/route API modul (pola streaming modul AI).
- **Koneksi per tenant.** Satu broker per deployment; tenant dibedakan lewat topik dan ACL broker. Buka kembali bila ada deployment multi-tenant yang brokernya memang berbeda per tenant.
- **Antrean di sisi aplikasi untuk publish saat terputus.** `publish()` menjawab `disconnected`; pemanggil yang butuh pengiriman pasti mengantrekannya sendiri lewat `enqueue()` lalu publish dari task-nya.
