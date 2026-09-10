#!/usr/bin/env bun
/**
 * `bun start` — run the production build on this host, without Docker (PRD Q-11).
 *
 * It starts the same two processes the compose stack runs (api + web) and, by default, fronts them
 * with ONE port, so nginx/apache only needs a single `proxy_pass` — no Caddy, no containers. The
 * routing table is the one in deploy/Caddyfile, so the app sees the same same-origin surface:
 *
 *   /v1/*  /docs  /docs/*  /openapi.json  → api        everything else → web
 *
 * `/metrics` is deliberately NOT routed (M-6): scrape it on 127.0.0.1:$API_PORT, never publicly.
 *
 *   bun run build          # generated registries + SvelteKit build (or: bun run build:release)
 *   bun start              # → http://127.0.0.1:3000, point the reverse proxy here
 *   bun start --no-proxy   # no gateway: web on $PORT, api on $API_PORT (proxy both, Caddy-style)
 *
 * Artefacts: `dist/` from `bun run build:release` when present (compiled api binary + bundled web),
 * otherwise apps/web/build and apps/api/src — the plain `bun run build` output.
 *
 * Environment comes from the usual files (Bun loads .env; `bun --env-file=.env.prod start` for a
 * production file). NODE_ENV is forced to `production`, so the app behaves as in the image:
 *   HOST / PORT          public listener of this command (default 127.0.0.1:3000)
 *   API_HOST / API_PORT  the api process (default 127.0.0.1:3001)
 *   WEB_PORT_INTERNAL    the web process behind the gateway (default 3010; --no-proxy uses PORT)
 * APP_ORIGIN, DATABASE_URL and friends are read by the api itself — see .env.prod.example.
 *
 * Migrations stay an explicit step (Q-4): run `bun run db:migrate` (or `dist/api migrate`) before
 * the first start and after every upgrade; this command never touches the schema.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const proxied = !process.argv.includes('--no-proxy');

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const apiHost = process.env.API_HOST ?? '127.0.0.1';
const apiPort = Number(process.env.API_PORT ?? 3001);
const webPort = proxied ? Number(process.env.WEB_PORT_INTERNAL ?? 3010) : port;
// Loopback address of the api for the web process and for the gateway: 0.0.0.0 is not dialable.
const localApiHost = apiHost === '0.0.0.0' || apiHost === '::' ? '127.0.0.1' : apiHost;

const dist = process.env.DIST_DIR ?? `${root}dist`;
const webDir = existsSync(`${dist}/web/index.js`) ? `${dist}/web` : `${root}apps/web/build`;
if (!existsSync(`${webDir}/index.js`)) {
  console.error(
    `start: build web belum ada (${webDir}/index.js).\n` +
      '  jalankan `bun run build` (SvelteKit) atau `sh scripts/build-release.sh` (dist/) lebih dulu.',
  );
  process.exit(1);
}
// The compiled binary when build-release.sh produced one, else the api sources under bun.
const apiCmd = existsSync(`${dist}/api`)
  ? [`${dist}/api`, 'serve']
  : [process.execPath, `${root}apps/api/src/index.ts`, 'serve'];

const procs = [
  {
    name: 'api',
    color: '\x1b[36m',
    cwd: root, // package.json (core version) and modules.catalog.json are read from here (G-16)
    cmd: apiCmd,
    env: { NODE_ENV: 'production', API_HOST: apiHost, API_PORT: String(apiPort) },
  },
  {
    name: 'web',
    color: '\x1b[35m',
    cwd: webDir, // adapter-node serves client/ relative to its own directory
    cmd: [process.execPath, 'index.js'],
    env: {
      NODE_ENV: 'production',
      HOST: proxied ? '127.0.0.1' : host,
      PORT: String(webPort),
      API_URL: process.env.API_URL ?? `http://${localApiHost}:${apiPort}`,
      // Behind a reverse proxy (this gateway, or nginx/apache directly): trust its headers for the
      // client IP and the public origin — same values as deploy/systemd/web.env.example.
      ADDRESS_HEADER: process.env.ADDRESS_HEADER ?? 'X-Forwarded-For',
      XFF_DEPTH: process.env.XFF_DEPTH ?? '1',
      PROTOCOL_HEADER: process.env.PROTOCOL_HEADER ?? 'x-forwarded-proto',
      HOST_HEADER: process.env.HOST_HEADER ?? 'x-forwarded-host',
    },
  },
];

const reset = '\x1b[0m';
const children: Bun.Subprocess[] = [];
let gateway: Bun.Server<undefined> | null = null;
let stopping = false;

function pipe(stream: ReadableStream<Uint8Array>, tag: string): void {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) console.log(`${tag} ${l}`);
    }
    if (buf.trim()) console.log(`${tag} ${buf}`);
  })();
}

/** SIGTERM both children (in-flight requests and jobs finish), then leave. */
async function stopAll(code: number): Promise<never> {
  if (stopping) process.exit(code);
  stopping = true;
  gateway?.stop();
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }
  await Promise.race([
    Promise.all(children.map((c) => c.exited)),
    Bun.sleep(25_000), // matches TimeoutStopSec of the systemd units
  ]);
  process.exit(code);
}

for (const p of procs) {
  const tag = `${p.color}[${p.name}]${reset}`;
  const child = Bun.spawn(p.cmd, {
    cwd: p.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...p.env },
  });
  children.push(child);
  pipe(child.stdout, tag);
  pipe(child.stderr, tag);
  child.exited.then((exitCode) => {
    if (!stopping) {
      console.log(`${tag} keluar dengan kode ${exitCode} — menghentikan yang lain`);
      void stopAll(exitCode ?? 1);
    }
  });
}

process.on('SIGINT', () => void stopAll(0));
process.on('SIGTERM', () => void stopAll(0));

if (proxied) {
  // Same paths as the @api matcher in deploy/Caddyfile.
  const apiPaths = /^\/(?:v1(?:\/|$)|docs(?:\/|$)|openapi\.json$)/;
  const apiOrigin = `http://${localApiHost}:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;

  try {
    gateway = Bun.serve({
      hostname: host,
      port,
      // Long AI/SSE responses (FR-H) must not be cut off; 255s is Bun's maximum.
      idleTimeout: 255,
      async fetch(req, server) {
        const url = new URL(req.url);
        const upstream = apiPaths.test(url.pathname) ? apiOrigin : webOrigin;
        const headers = new Headers(req.headers);
        // Bun's fetch decodes a compressed response body but keeps Content-Encoding, which would
        // make the browser decompress twice; ask the upstream for identity instead. The public
        // compression belongs to nginx/apache anyway.
        headers.delete('accept-encoding');
        // This gateway sits on the same host as the app: it is not an extra trust hop, so an
        // existing X-Forwarded-* set (nginx, apache) is passed through untouched and XFF_DEPTH
        // stays 1. Without a front proxy, these are set here from the connection itself.
        if (!headers.has('x-forwarded-for')) {
          headers.set('x-forwarded-for', server.requestIP(req)?.address ?? '127.0.0.1');
        }
        if (!headers.has('x-forwarded-proto')) headers.set('x-forwarded-proto', 'http');
        const hostHeader = req.headers.get('host');
        if (!headers.has('x-forwarded-host') && hostHeader) {
          headers.set('x-forwarded-host', hostHeader);
        }
        try {
          const res = await fetch(`${upstream}${url.pathname}${url.search}`, {
            method: req.method,
            headers,
            body: req.body,
            duplex: 'half', // streamed request bodies (uploads, Q-16)
            redirect: 'manual', // 302 belongs to the browser, not to us
          } as RequestInit);
          const out = new Headers(res.headers);
          if (out.has('content-encoding')) {
            out.delete('content-encoding'); // body arrived decoded — see the note above
            out.delete('content-length');
          }
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: out,
          });
        } catch (err) {
          console.error(
            `[gateway] ${req.method} ${url.pathname} → ${upstream} gagal: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return new Response('502 — backend belum siap atau menolak koneksi\n', {
            status: 502,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          });
        }
      },
    });
  } catch (err) {
    console.error(
      `start: tidak bisa mendengarkan di ${host}:${port} — ${
        err instanceof Error ? err.message : String(err)
      }\n  ubah PORT, atau matikan proses yang memakai port itu.`,
    );
    await stopAll(1);
  }
}

/** Wait until both processes answer, so the "siap" line is not a lie. */
async function waitReady(): Promise<boolean> {
  const deadline = Date.now() + 90_000;
  const probes: [string, string][] = [
    ['api', `http://${localApiHost}:${apiPort}/v1/health`],
    [
      'web',
      `http://${proxied ? '127.0.0.1' : host === '0.0.0.0' ? '127.0.0.1' : host}:${webPort}/robots.txt`,
    ],
  ];
  for (const [name, probeUrl] of probes) {
    for (;;) {
      if (stopping) return false;
      try {
        const res = await fetch(probeUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) {
        console.error(`start: ${name} belum menjawab dalam 90s (${probeUrl}) — lihat log di atas`);
        return false;
      }
      await Bun.sleep(250);
    }
  }
  return true;
}

if (await waitReady()) {
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  console.log(
    proxied
      ? `\x1b[32m[start]\x1b[0m siap — http://${shown}:${port} (satu port: web + /v1 + /docs). ` +
          `Arahkan nginx/apache ke sini; /metrics tetap privat di http://${localApiHost}:${apiPort}/metrics`
      : `\x1b[32m[start]\x1b[0m siap — web http://${shown}:${webPort}, api http://${localApiHost}:${apiPort} ` +
          '(proxy: / → web, /v1 /docs /openapi.json → api)',
  );
}
