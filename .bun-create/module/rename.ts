#!/usr/bin/env bun
/**
 * `bun run rename <NewName>` — rename this starter module (Hello → NewName) in place: module.json,
 * package name, namespace (tables, permissions, menu ids, i18n keys, routes, tests). Run once,
 * right after `bun create module`. Resource words (note/notes) are yours to change by hand.
 */
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dir;
const next = process.argv[2] ?? '';
if (!/^[A-Z][A-Za-z0-9]*$/.test(next)) {
  console.error('Pemakaian: bun run rename <NewName>   (PascalCase, mis. Billing)');
  process.exit(1);
}
const current = (JSON.parse(readFileSync(join(here, 'module.json'), 'utf8')) as { name: string })
  .name;
if (current === next) {
  console.log(`rename: sudah bernama ${next}`);
  process.exit(0);
}
const from = { pascal: current, lower: current.toLowerCase(), upper: current.toUpperCase() };
const to = { pascal: next, lower: next.toLowerCase(), upper: next.toUpperCase() };
const skip = /^(\.git|node_modules|\.core)$/;
const textFile = /\.(ts|js|json|svelte|md|yml|yaml|css|txt)$/;
let files = 0;
function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    if (skip.test(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!textFile.test(entry) || entry === 'rename.ts') continue;
    const before = readFileSync(p, 'utf8');
    const after = before
      .replaceAll(from.pascal, to.pascal)
      .replace(new RegExp(`(^|[^a-zA-Z])${from.lower}(?=[^a-zA-Z]|$)`, 'g'), `$1${to.lower}`)
      .replaceAll(from.upper, to.upper);
    if (after !== before) {
      writeFileSync(p, after);
      files++;
    }
    if (entry.includes(from.lower))
      renameSync(p, join(dir, entry.replaceAll(from.lower, to.lower)));
  }
}
walk(here);
console.log(
  `rename: ${from.pascal} → ${to.pascal} (${files} berkas). Namespace sekarang "${to.lower}": tabel ${to.lower}_*, izin ${to.lower}.*, /m/${to.lower}/*`,
);
