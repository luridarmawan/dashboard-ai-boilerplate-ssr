# Deployment Single-VPS

| | |
|---|---|
| **Status** | Versi 1 — paket M0 (gate 7). Panduan langkah-demi-langkah dari VPS kosong (Q-10) dan backup/restore (Q-8) menyusul di M7 |
| **Berkas** | [`compose.prod.yml`](../compose.prod.yml) · [`Dockerfile`](../Dockerfile) · [`deploy/Caddyfile`](../deploy/Caddyfile) · [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) · [`.env.prod.example`](../.env.prod.example) |
| **Kontrak** | [`PRD.md` §4.4](./PRD.md) (Keputusan D, E, F, M), FR-Q |

Target deployment adalah **satu VPS biasa** dengan Docker (PRD §4.4). Tidak ada layanan berbayar milik vendor, tidak ada serverless.

---

## 1. Topologi

```
:80/:443 ─► caddy ──► /            ─► web  (SvelteKit SSR, adapter-node di atas Bun)
                  └─► /v1/*, /docs, /openapi.json ─► api (Elysia) ×N ──► mysql
                                                                   └──► valkey (opsional)
```

- **Satu origin** (Keputusan E): web dan API disajikan dari domain yang sama lewat path. Tidak ada CORS, tidak ada cookie lintas-domain.
- **Caddy** (Keputusan D): TLS otomatis Let's Encrypt untuk `DOMAIN` sungguhan; untuk `localhost` Caddy memakai CA internalnya. `api` diresolusi lewat DNS Docker sebagai *dynamic upstream* — setiap replika `api` otomatis ikut dilayani.
- **`api` stateless** (Keputusan F): tanpa port host, tanpa `container_name`, jadi `--scale api=N` langsung bekerja. State bersama ada di database (Keputusan M); Valkey hanya percepatan opsional (`--profile redis`).
- **Migrasi adalah langkah eksplisit** (Q-4): service `migrate` (profil `ops`) dijalankan operator, tidak pernah otomatis saat container start — dua instance yang menyala bersamaan tidak berebut migrasi.

## 2. Menjalankan

```bash
cp .env.prod.example .env.prod          # isi DOMAIN, ACME_EMAIL, MYSQL_*_PASSWORD
docker compose --env-file .env.prod -f compose.prod.yml build
docker compose --env-file .env.prod -f compose.prod.yml up -d
docker compose --env-file .env.prod -f compose.prod.yml run --rm migrate
docker compose --env-file .env.prod -f compose.prod.yml up -d --scale api=3
```

Pemeriksaan cepat:

```bash
curl -s https://DOMAIN/v1/health      # {"success":true,"data":{"status":"ok","uptime":…,"instance":"…"}}
curl -s https://DOMAIN/v1/ready       # database (dan Redis bila aktif) menjawab
curl -sI https://DOMAIN/ | head -1    # HTTP/2 200 — halaman ter-SSR
```

`instance` di `/v1/health` menyebut replika yang menjawab; dengan `--scale api=3`, beberapa panggilan berturut-turut menunjukkan tiga nilai berbeda.

**Peringatan operasional saat mengubah satu service:** `docker compose up -d caddy` (tanpa `--scale`) **mengembalikan `api` ke satu replika**. Selalu sertakan `--scale api=N` pada setiap `up`, atau tulis `deploy.replicas` di override lokal Anda.

## 3. Image

Satu `Dockerfile`, dua target dari satu stage build: install penuh → `bun run bootstrap` + build web → **install produksi bersih** (semua `node_modules` dihapus dulu, karena pemangkasan di tempat meninggalkan paket dev di *store* Bun dan menggandakan ukuran image tiga kali lipat) → runtime `oven/bun:alpine`, user `bun`, `HEALTHCHECK`.

| Image | Ukuran (M0) | Isi utama |
|---|---|---|
| `dab/api` | **212 MB** | bun 70 MB · `node_modules` produksi 67 MB (`typescript` 23 MB — dependensi runtime `elysia`, bukan sisa devDeps; `drizzle-orm` 17 MB) · base alpine · kode < 1 MB |
| `dab/web` | **213 MB** | serupa; `build/` adapter-node 1,8 MB |

PRD Q-2 menargetkan **< 150 MB**. Dengan runtime Bun (70 MB) dan `typescript` yang dibawa `elysia`, lantai realistisnya ±190 MB. Pilihan yang tersedia — dan ini keputusan produk, bukan teknis semata: menerima ±200 MB dan merevisi Q-2, atau `bun build --compile` menjadi satu binary (menghilangkan `node_modules` tapi binary-nya sendiri ±90 MB). Dialect dipilih saat build (`--build-arg DB_DIALECT=postgres`) karena skema ter-generate mengikat satu driver (§4.3).

## 4. Yang dijaga compose

| Kebutuhan | Cara |
|---|---|
| Restart otomatis saat proses mati & saat host reboot (Q-6) | `restart: unless-stopped` di setiap service |
| Log tidak memenuhi disk (Q-7) | driver `json-file`, `max-size 10m`, `max-file 5` |
| Berkas unggahan (Q-9) | volume `uploads` → `/data/uploads`, `UPLOADS_DIR` |
| Header keamanan (§7) | HSTS, `nosniff`, `X-Frame-Options DENY`, `Referrer-Policy` di Caddy; `Server` disembunyikan |
| Port host bisa dipindah | `HTTP_PORT` / `HTTPS_PORT` bila 80/443 sudah dipakai |

## 5. Nginx

Bagi yang punya standar Nginx sendiri: [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) memetakan aturan yang sama (`/v1`, `/docs`, `/openapi.json` → api; sisanya → web; `proxy_buffering off` untuk streaming AI). TLS diserahkan ke certbot Anda.

## 6. Belum ada di sini

Panduan VPS-kosong-ke-HTTPS < 15 menit (Q-10), backup terjadwal + restore teruji (Q-8, O-7), deploy tanpa downtime (Q-12), `preflight` (Q-13), batas sumber daya per service (Q-14), unit systemd tanpa Docker (Q-11) — semuanya M7 / §8 ROADMAP.
