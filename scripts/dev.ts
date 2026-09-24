#!/usr/bin/env bun
/**
 * `bun dev` — API and web in one command (P-1). `predev` has already run modules:sync and
 * db:codegen, so both processes start from a fresh registry.
 *
 * Output is prefixed per process; Ctrl-C stops both. If either exits on its own, the other
 * is stopped too — a half-running dev stack hides errors.
 */
import { fileURLToPath } from 'node:url';
import { printBanner } from './banner.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

// Alamat dev server web — sumbernya sama dengan apps/web/vite.config.ts (root .env), supaya
// banner di bawah menyebut port yang benar-benar dipakai.
const webHost = process.env.WEB_HOST ?? '127.0.0.1';
const webPort = Number(process.env.WEB_PORT ?? 5173);
const webUrl = `http://${webHost === '0.0.0.0' || webHost === '::' ? '127.0.0.1' : webHost}:${webPort}`;
const apiUrl = `http://${process.env.API_HOST ?? '127.0.0.1'}:${process.env.API_PORT ?? 3001}`;

const procs = [
  { name: 'api', color: '\x1b[36m', cwd: `${root}apps/api`, cmd: ['bun', 'run', 'dev'] },
  {
    name: 'web',
    color: '\x1b[35m',
    cwd: `${root}apps/web`,
    cmd: ['bun', 'run', 'dev'],
    // A dev server reached through a reverse proxy (APP_ORIGIN domain) sees the proxy's loopback
    // address on the socket; trust X-Forwarded-For like `bun start` does, so Last Login IP /
    // Last Active IP record the visitor. Without a proxy the header is absent and the socket
    // address stands. Set ADDRESS_HEADER= (empty) to switch it off.
    env: { ADDRESS_HEADER: process.env.ADDRESS_HEADER ?? 'X-Forwarded-For' },
  },
];

const reset = '\x1b[0m';
const children: Bun.Subprocess[] = [];
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

function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

for (const p of procs) {
  const tag = `${p.color}[${p.name}]${reset}`;
  const child = Bun.spawn(p.cmd, {
    cwd: p.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...p.env, FORCE_COLOR: '1' },
  });
  children.push(child);
  pipe(child.stdout, tag);
  pipe(child.stderr, tag);
  child.exited.then((code) => {
    if (!stopping) {
      console.log(`${tag} keluar dengan kode ${code} — menghentikan yang lain`);
      stopAll(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

/**
 * Banner menyusul setelah Vite benar-benar menjawab, bukan saat proses baru di-spawn: kalau
 * portnya ternyata dipakai proses lain, alamat yang dicetak akan bohong. /favicon.ico adalah
 * berkas statis — tidak memicu kompilasi SSR hanya untuk sebuah probe.
 */
const deadline = Date.now() + 90_000;
while (!stopping && Date.now() < deadline) {
  try {
    const res = await fetch(`${webUrl}/favicon.ico`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      printBanner(webUrl, 'development', `api ${apiUrl} (Exposed through the Vite proxy at ${webUrl}/v1)`);
      break;
    }
  } catch {
    /* belum menyala */
  }
  await Bun.sleep(250);
}
