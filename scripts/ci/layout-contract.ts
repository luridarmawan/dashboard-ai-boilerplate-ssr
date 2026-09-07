#!/usr/bin/env bun
/**
 * L-8 guard: every registered layout component renders EVERY region its kind requires.
 * Reads the .svelte source for `{@render <region>(` — a layout that forgets a region is
 * rejected here with the layout and region named, not discovered on a page in production.
 */
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { layouts, REGIONS } from '@core/ui-theme';

const root = fileURLToPath(new URL('../..', import.meta.url));
let failures = 0;
// Module layouts (`<ns>.<id>`) are verified by modules:sync against their own component.
for (const l of layouts().filter((x) => !x.id.includes('.'))) {
  const file = `${root}apps/web/src/lib/layouts/${l.id}/Layout.svelte`;
  if (!existsSync(file)) {
    failures++;
    console.error(`  !! layout ${l.id}: komponen tidak ada (${file})`);
    continue;
  }
  const src = readFileSync(file, 'utf8');
  const missing = REGIONS[l.kind].filter((r) => !new RegExp(`\\{@render\\s+${r}\\s*\\(`).test(src));
  if (missing.length) {
    failures++;
    console.error(`  !! layout ${l.id} (${l.kind}): region belum diisi: ${missing.join(', ')}`);
  } else {
    console.log(`  ✓ layout ${l.id} (${l.kind}): ${REGIONS[l.kind].length} region terisi`);
  }
}
if (failures) {
  console.error(`\nlayout-contract: ${failures} layout melanggar kontrak region (L-8)`);
  process.exit(1);
}
console.log('layout-contract: semua layout mengisi region yang diwajibkan jenisnya');
