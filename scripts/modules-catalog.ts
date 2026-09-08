#!/usr/bin/env bun
/**
 * Module catalog on the command line (PRD G-16):
 *   bun modules:search [teks]          — list catalog entries with their status against this host
 *   bun modules:install <Name> [--ref] — resolve repo + ref from the catalog and run `bun modules:add`
 * The catalog is `modules.catalog.json` (or MODULES_CATALOG_URL / MODULES_CATALOG_FILE).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Catalog,
  catalogSchema,
  compareCatalog,
  modulesFileSchema,
  searchCatalog,
} from '@core/module-kit';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const [mode, ...rest] = process.argv.slice(2);

async function loadCatalog(): Promise<Catalog> {
  const url = process.env.MODULES_CATALOG_URL?.trim();
  if (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`katalog ${url}: HTTP ${res.status}`);
    return catalogSchema.parse(await res.json());
  }
  const file = process.env.MODULES_CATALOG_FILE?.trim() || join(root, 'modules.catalog.json');
  if (!existsSync(file)) throw new Error(`katalog tidak ada: ${file}`);
  return catalogSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}
function installed(): { name: string; version: string }[] {
  const list = modulesFileSchema.parse(
    JSON.parse(readFileSync(join(root, 'modules.json'), 'utf8')),
  );
  return list.modules.map((m) => {
    const dir = m.source === 'package' ? null : join(root, m.path ?? `modules/${m.name}`);
    let version = '0.0.0';
    try {
      if (dir) version = String(JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8')).version);
    } catch {
      /* not checked out */
    }
    return { name: m.name, version };
  });
}
const coreVersion = (): string =>
  String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0');

if (mode === 'search') {
  const q = rest.filter((a) => !a.startsWith('--')).join(' ');
  const view = compareCatalog(await loadCatalog(), installed(), coreVersion());
  const hits = searchCatalog(view, q);
  if (!hits.length) {
    console.log(q ? `Tidak ada modul cocok "${q}".` : 'Katalog kosong.');
    process.exit(0);
  }
  const w = Math.max(...hits.map((e) => e.name.length), 6);
  for (const e of hits) {
    const st =
      e.status === 'installed'
        ? `terpasang v${e.installedVersion}`
        : e.status === 'update'
          ? `pembaruan v${e.installedVersion} → v${e.version}`
          : e.status === 'incompatible'
            ? `tidak cocok (butuh core ${e.engines.core})`
            : `tersedia v${e.version}`;
    console.log(
      `${e.name.padEnd(w)}  ${st.padEnd(34)}  ${e.description?.id ?? ''}${e.tags.length ? `  [${e.tags.join(', ')}]` : ''}`,
    );
    if (e.installCommand) console.log(`${''.padEnd(w)}  → ${e.installCommand}`);
  }
} else if (mode === 'install') {
  const name = rest.find((a) => !a.startsWith('--'));
  if (!name) {
    console.error('Pemakaian: bun modules:install <Name> [--ref <tag|commit>]');
    process.exit(1);
  }
  const refOpt = rest.indexOf('--ref');
  const catalog = await loadCatalog();
  const entry = catalog.modules.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!entry) {
    console.error(
      `modules:install: "${name}" tidak ada di katalog — lihat \`bun modules:search\`.`,
    );
    process.exit(1);
  }
  const view = compareCatalog({ modules: [entry] }, installed(), coreVersion())[0];
  if (entry.bundled) {
    console.log(
      `${entry.name} sudah menjadi bagian core (${entry.path ?? 'bundled'}); tidak ada yang dipasang.`,
    );
    process.exit(0);
  }
  if (view?.status === 'incompatible') {
    console.error(
      `modules:install: ${entry.name} v${entry.version} butuh core ${entry.engines.core}, terpasang ${coreVersion()} (G-11).`,
    );
    process.exit(1);
  }
  if (view?.status === 'installed') {
    console.log(`${entry.name} v${view.installedVersion} sudah terpasang.`);
    process.exit(0);
  }
  const ref = refOpt >= 0 ? (rest[refOpt + 1] ?? entry.ref) : entry.ref;
  console.log(`→ bun modules:add ${entry.repo} --ref ${ref} --name ${entry.name}`);
  const p = Bun.spawnSync(
    ['bun', 'run', 'scripts/modules-add.ts', entry.repo, '--ref', ref, '--name', entry.name],
    { cwd: root, stdout: 'inherit', stderr: 'inherit' },
  );
  process.exit(p.exitCode ?? 1);
} else {
  console.error('Pemakaian: bun modules:search [teks] | bun modules:install <Name> [--ref <tag>]');
  process.exit(1);
}
