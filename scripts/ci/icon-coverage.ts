#!/usr/bin/env bun
/**
 * L-5 guard: every icon set must map EVERY core semantic name (icons/registry.json). A hole
 * would only surface on a rarely opened page, so it fails the build instead. Reads the mapping
 * files as text — no Svelte runtime needed in CI.
 */
import { readFileSync } from 'node:fs';
import { CORE_ICONS, ICON_SETS } from '@core/ui-theme';

const root = new URL('../..', import.meta.url).pathname;
let failures = 0;
// Module sets (`<ns>.<id>`) are verified by modules:sync against their own glyph map.
for (const set of Object.keys(ICON_SETS).filter((id) => !id.includes('.'))) {
  const file = `${root}apps/web/src/lib/icons/${set}.ts`;
  let src = readFileSync(file, 'utf8');
  const reexport = /export \{ glyphs \} from '\.\/([\w-]+)\.ts'/.exec(src);
  if (reexport) src = readFileSync(`${root}apps/web/src/lib/icons/${reexport[1]}.ts`, 'utf8');
  const keys = new Set([...src.matchAll(/^\s+'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]));
  const missing = CORE_ICONS.filter((n) => !keys.has(n));
  if (missing.length) {
    failures++;
    console.error(
      `  !! set ${set}: ${missing.length} nama ikon tidak dipetakan: ${missing.join(', ')}`,
    );
  } else {
    console.log(`  ✓ set ${set}: ${CORE_ICONS.length}/${CORE_ICONS.length} nama tertutup`);
  }
}
if (failures) {
  console.error(`\nicon-coverage: ${failures} set ikon bolong (L-5)`);
  process.exit(1);
}
console.log('icon-coverage: semua set ikon menutup seluruh nama core');
