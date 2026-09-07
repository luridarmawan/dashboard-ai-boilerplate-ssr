#!/usr/bin/env bun
/**
 * `bun dev` — API and web in one command (P-1). `predev` has already run modules:sync and
 * db:codegen, so both processes start from a fresh registry.
 *
 * Output is prefixed per process; Ctrl-C stops both. If either exits on its own, the other
 * is stopped too — a half-running dev stack hides errors.
 */
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const procs = [
  { name: 'api', color: '\x1b[36m', cwd: `${root}apps/api`, cmd: ['bun', 'run', 'dev'] },
  { name: 'web', color: '\x1b[35m', cwd: `${root}apps/web`, cmd: ['bun', 'run', 'dev'] },
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
    env: { ...process.env, FORCE_COLOR: '1' },
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
