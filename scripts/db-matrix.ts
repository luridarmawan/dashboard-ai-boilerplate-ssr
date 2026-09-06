#!/usr/bin/env bun
/**
 * `bun db:matrix` — M0 gate #2, locally: the same migrations and the same smoke test run
 * against MySQL 8, MariaDB 11 and PostgreSQL 16 (P-9). Each dialect runs in its own
 * subprocess because codegen selects the active dialect at load time and `getDb()` is a
 * per-process singleton — exactly how the CI matrix runs them as separate jobs.
 *
 * Expects the databases from `docker compose --profile matrix up -d --wait`.
 * Host ports follow the same env overrides as compose.yml.
 */

interface Target {
  dialect: 'mysql' | 'mariadb' | 'postgres';
  url: string;
}

const p = (name: string, fallback: string) => process.env[name] ?? fallback;

// Full URLs win (used when this script itself runs inside the compose network, e.g.
// `bun db:matrix:docker` or CI service containers); otherwise host ports from compose.yml.
const targets: Target[] = [
  {
    dialect: 'mysql',
    url: p('MATRIX_MYSQL_URL', `mysql://app:app@127.0.0.1:${p('MYSQL_PORT', '33306')}/app`),
  },
  {
    dialect: 'mariadb',
    url: p('MATRIX_MARIADB_URL', `mysql://app:app@127.0.0.1:${p('MARIADB_PORT', '33307')}/app`),
  },
  {
    dialect: 'postgres',
    url: p(
      'MATRIX_POSTGRES_URL',
      `postgres://app:app@127.0.0.1:${p('POSTGRES_PORT', '35432')}/app`,
    ),
  },
];

const only = process.argv.slice(2);
const selected = only.length ? targets.filter((t) => only.includes(t.dialect)) : targets;

interface Result {
  dialect: string;
  step: string;
  ok: boolean;
  ms: number;
  output: string;
}
const results: Result[] = [];

async function run(target: Target, step: string, args: string[]): Promise<boolean> {
  const started = performance.now();
  const proc = Bun.spawn(['bun', 'run', ...args], {
    cwd: new URL('../packages/db', import.meta.url).pathname,
    env: { ...process.env, DB_DIALECT: target.dialect, DATABASE_URL: target.url, NODE_ENV: 'test' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const ok = code === 0;
  results.push({
    dialect: target.dialect,
    step,
    ok,
    ms: Math.round(performance.now() - started),
    output: (out + err).trim(),
  });
  return ok;
}

for (const t of selected) {
  console.log(`\n▶ ${t.dialect}  (${t.url.replace(/:[^:@]+@/, ':***@')})`);
  const steps: Array<[string, string[]]> = [
    ['codegen', ['scripts/codegen.ts']],
    ['migrate', ['scripts/migrate.ts']],
    ['migrate again (idempotent)', ['scripts/migrate.ts']],
    ['smoke', ['scripts/smoke.ts']],
  ];
  for (const [name, args] of steps) {
    const ok = await run(t, name, args);
    const r = results.at(-1);
    console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(28)} ${String(r?.ms ?? 0).padStart(6)} ms`);
    if (!ok) {
      console.log(
        (r?.output ?? '')
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n'),
      );
      break; // later steps of this dialect are meaningless after a failure
    }
  }
}

const failed = results.filter((r) => !r.ok);
const dialectsRun = new Set(results.map((r) => r.dialect));
const dialectsOk = [...dialectsRun].filter((d) => !failed.some((f) => f.dialect === d));

console.log(`\n${'─'.repeat(60)}`);
console.log(`Dialect lolos : ${dialectsOk.join(', ') || '-'}`);
console.log(`Dialect gagal : ${[...new Set(failed.map((f) => f.dialect))].join(', ') || '-'}`);
if (failed.length) process.exit(1);
