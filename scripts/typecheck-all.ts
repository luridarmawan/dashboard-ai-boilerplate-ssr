#!/usr/bin/env bun
/**
 * `bun run typecheck` — run each workspace package's own `typecheck` script.
 *
 * Replaces `bun run --filter '*' typecheck`, which derives the workspace folder from the
 * package name and therefore cannot find `modules/Dummy` (package `@modules/dummy`).
 * Module folders are folder-cased by contract (PRD §4.5); the harness adapts, not the contract.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Glob } from 'bun';

const root = fileURLToPath(new URL('..', import.meta.url));
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  workspaces?: string[];
};

// A module folder that is not registered in modules.json is not part of the build (gate M5 #4): its
// generated schema/registry entries do not exist, so typechecking it would only report that fact.
const registered = new Set(
  (
    JSON.parse(readFileSync(join(root, 'modules.json'), 'utf8')) as {
      modules: { path?: string; name: string }[];
    }
  ).modules.map((m) => (m.path ?? `modules/${m.name}`).replace(/\/$/, '')),
);

const dirs = new Set<string>();
for (const pattern of rootPkg.workspaces ?? []) {
  for await (const m of new Glob(`${pattern}/package.json`).scan({ cwd: root, dot: false })) {
    if (m.includes('node_modules/')) continue;
    dirs.add(join(root, m, '..'));
  }
}

let failed = 0;
for (const dir of [...dirs].sort()) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name?: string;
    scripts?: Record<string, string>;
  };
  const rel = relative(root, dir);
  if (rel.startsWith('modules/') && !registered.has(rel)) {
    console.log(`  – ${rel.padEnd(28)} (tidak terdaftar di modules.json — dilewati)`);
    continue;
  }
  if (!pkg.scripts?.typecheck) {
    console.log(`  – ${rel.padEnd(28)} (tidak ada skrip typecheck)`);
    continue;
  }
  const started = performance.now();
  const proc = Bun.spawn(['bun', 'run', 'typecheck'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const ms = Math.round(performance.now() - started);
  if (code === 0) console.log(`  ✓ ${rel.padEnd(28)} ${String(ms).padStart(6)} ms`);
  else {
    failed++;
    console.log(`  ✗ ${rel.padEnd(28)} ${String(ms).padStart(6)} ms`);
    console.log(
      (out + err)
        .trim()
        .split('\n')
        .filter((l) => !l.startsWith('$ '))
        .map((l) => `      ${l}`)
        .join('\n'),
    );
  }
}
if (failed) {
  console.error(`typecheck: ${failed} paket gagal`);
  process.exit(1);
}
