#!/usr/bin/env bun
/**
 * `bun run rename <NewName>` — rename this starter module (Hello → NewName) in place: module.json,
 * package name, namespace (tables, permissions, menu ids, i18n keys, routes, tests). Run once,
 * right after `bun create module`. Resource words (note/notes) are yours to change by hand.
 *
 * The folder you created it in means nothing: `bun create module ../mod-billing` and
 * `bun create module ../Billing` both produce a module called Hello until this runs.
 */
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dir;
const next = process.argv[2] ?? '';
if (!/^[A-Z][A-Za-z0-9]{1,39}$/.test(next)) {
  console.error('Pemakaian: bun run rename <NewName>   (PascalCase, mis. Billing)');
  process.exit(1);
}
const current = (JSON.parse(readFileSync(join(here, 'module.json'), 'utf8')) as { name: string })
  .name;
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
      // camelCase identifiers such as helloNotes → billingNotes
      .replace(new RegExp(`(^|[^a-zA-Z])${from.lower}(?=[A-Z])`, 'g'), `$1${to.lower}`)
      .replaceAll(from.upper, to.upper);
    if (after !== before) {
      writeFileSync(p, after);
      files++;
    }
    if (entry.includes(from.lower))
      renameSync(p, join(dir, entry.replaceAll(from.lower, to.lower)));
  }
}
if (current !== next) walk(here);

/**
 * `bun create` overwrites package.json's name with the destination folder's name (`mod-billing`,
 * `Billing`), which is neither the template's name nor the convention every other module follows —
 * and the rename above cannot repair it, because the string it would have replaced is gone. Put it
 * back to `@modules/<namespace>` whatever the folder is called.
 */
const pkgPath = join(here, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
const want = `@modules/${to.lower}`;
if (pkg.name !== want) {
  pkg.name = want;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log(
  current === next
    ? `rename: sudah bernama ${next} (paket: ${want})`
    : `rename: ${from.pascal} → ${to.pascal} (${files} berkas). Namespace sekarang "${to.lower}": tabel ${to.lower}_*, izin ${to.lower}.*, /m/${to.lower}/*`,
);
