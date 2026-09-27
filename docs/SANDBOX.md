# Sandbox: strategi isolasi eksekusi untuk job dan AI agent

> Status: **catatan arsitektur (RFC awal)** — belum menjadi keputusan PRD. Berkas ini merinci opsi isolasi eksekusi untuk pekerjaan yang menjalankan kode (AI agent: Claude Code, OpenCode, OpenClaw; skrip hasil generate; konversi file), di lingkungan multi-user. Pendamping: `docs/SERVICE-WORKER.md`.

## Mengapa perlu sandbox

Agent CLI menjalankan **kode dan perintah shell** atas nama user. Tanpa isolasi, risikonya: agent membaca kredensial host (`~/.claude`, `.env`, SSH key), menyentuh file di luar workspace-nya, mengakses internal network (VPS/DB/Redis), atau loop liar yang memakan resource. Multi-user membuat satu tenant tidak boleh bisa menyuruh agent membaca data tenant lain.

## Tingkatan isolasi (dari ringan ke berat)

### Tingkat 1 — Batasan tool level proses (wajib, murah, BUKAN sandbox sejati)

Claude Code / OpenCode punya kontrol izin bawaan:

- `--permission-mode` restriktif (mis. `plan`, `acceptEdits`)
- `--allowedTools "Read Edit Glob Grep"` — whitelist eksplisit
- `--disallowedTools "Bash WebFetch"` — blacklist

Mencegah agent *mengajukan* aksi berbahaya, tetapi keputusan tetap di satu proses dengan akses penuh — anggap lapis pertama, bukan dinding.

### Tingkat 2 — Sandboxing OS-level di host (murah, risiko sedang)

- **systemd-run** dengan `PrivateTmp=yes ProtectHome=yes ProtectSystem=strict NoNewPrivileges=yes IPAddressDeny=any ReadOnlyPaths=...`
- **bubblewrap / firejail** (namespace user+mount+pid): rootfs read-only, hanya workspace writable. Claude Code punya fitur sandbox bawaan berbasis bubblewrap di Linux.

Kelemahan: masih share kernel dengan host; perlu mematikan egress default (`unshare -n` / `IPAddressDeny`).

### Tingkat 3 — Container ephemeral per job (rekomendasi utama)

Titik manis untuk worker multi-user di mesin ini (Docker sudah tersedia):

```bash
docker run --rm \
  --network none \            # atau egress-proxy dengan allowlist domain
  --read-only --tmpfs /tmp \
  -v /srv/jobs/<jobid>/workspace:/work:rw \   # HANYA workspace job ini
  --memory 1g --cpus 1 --pids-limit 128 \
  --user 1000:1000 \
  bun-agent:latest  claude -p "<task>" --output-format stream-json
```

Poin penting:

- **Filesystem minimal**: `--read-only` + mount hanya workspace job. Kredensial host (`~/.claude` berisi token API, `.env`, SSH key) **tidak ikut di-mount** — ini kesalahan paling umum dan paling fatal.
- **Network**: default `--network none` untuk task offline; task yang butuh internet (API LLM, fetch docs) lewat **egress proxy** (mis. container squid kecil dengan allowlist domain) agar tidak bisa memindai internal LAN/DB.
- **Resource cap**: `--memory/--cpus/--pids-limit` — loop liar mati sendiri tanpa menyeret host.
- **Ephemeral**: `--rm`, workspace dibuang setelah job; hasil lewat *artifact contract*: agent menulis output di `/work/out/`, worker menyerapnya ke DB/S3.

**Bagaimana worker men-spawn container — dua opsi:**

| Opsi | Cara | Risiko & mitigasi |
|---|---|---|
| DinD (Docker-in-Docker) | worker punya daemon Docker sendiri | berat; socket host tidak diekspos |
| Sibling via socket | worker mount `/var/run/docker.sock` | socket = root host — mitigasi: worker non-root + **socket proxy** (`docker-socket-proxy`, hanya `POST /containers`), atau worker jadi "runner" kecil di host dengan satu-satunya tugas spawn job |

### Tingkat 4 — MicroVM (paling kuat, umumnya overkill)

Firecracker / Kata Containers / gVisor — kernel terpisah per job; kernel bug pun tidak tembus. Layak hanya jika: user eksternal penuh (tidak dipercaya), agent menjalankan dependensi asing yang tidak diaudit, atau tuntutan compliance. Alternatif managed: E2B, Fly machines, Modal (bayar per detik, sudah tersandbox). Untuk user internal/deploy awal: tidak perlu.

## Resep konkret untuk repo ini (multi-user, 1 VPS)

1. **Worker queue** (`QUEUE_ONLY=1`, lihat `docs/SERVICE-WORKER.md`) jalan di host sebagai systemd unit — bukan container — dengan tugas sempit: klaim job, spawn container job, baca output, tulis DB. Attack surface kecil dan auditable.
2. **Job = container ephemeral** Tingkat 3: read-only, network none default, mount hanya workspace job, cap resource, non-root, hard timeout di luar container (`timeout 600`).
3. **Di dalam container**: agent headless + `--allowedTools` sempit + workspace git (diff mudah direview).
4. **Gerbang manusia untuk aksi destruktif**: hasil agent = branch + PR, bukan push langsung ke main. Merge tetap butuh persetujuan manusia — sandbox sosial yang melengkapi teknis.
5. **Secret**: satu-satunya kredensial di dalam container adalah token LLM per vendor (inject via env per job, bisa dirotasi), tidak pernah kredensial host/git.

## Ringkasan pilihan

| Risiko | Sandbox |
|---|---|
| Percobaan pertama / internal | Tingkat 1 + 2 (allowedTools + bubblewrap/systemd) |
| Produksi multi-user (kasus repo ini) | **Tingkat 3 + 1 + gerbang manusia** — rasio keamanan/effort terbaik |
| User eksternal penuh / compliance | Tingkat 4 (microVM / platform managed) |
