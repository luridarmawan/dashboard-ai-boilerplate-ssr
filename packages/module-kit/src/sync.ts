import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TableDef } from '@core/db/descriptor';
import type { MenuEntryDef, PermissionDef } from './contract.ts';
import {
  type ModuleManifest,
  type ModuleSource,
  moduleManifestSchema,
  modulesFileSchema,
  namespaceOf,
  satisfiesCore,
} from './manifest.ts';

/**
 * The `modules:sync` engine (Decision C, Decision G; G-2, G-9, G-10, G-11).
 *
 * Reads `modules.json`, validates every module's `module.json`, loads the module's
 * contract files, enforces namespaces, and writes the generated registries that core
 * consumes. Core never imports a module by name — it imports these generated files.
 *
 * Collects EVERY problem before failing, and every message names the module (and both
 * modules on a collision), because a sync that fails one error at a time is the single
 * most annoying part of a module system.
 */

export interface SyncOptions {
  /** Repository root — where `modules.json` lives. */
  readonly root: string;
  /** Write generated files (default true). Tests set false and inspect the result. */
  readonly write?: boolean;
  /** Core semver version to check `engines.core` against. Defaults to root package.json. */
  readonly coreVersion?: string;
  /** Core semantic icon names (icons/registry.json). Defaults to reading the registry. */
  readonly coreIcons?: readonly string[];
}

export interface ModuleRecord {
  readonly name: string;
  readonly ns: string;
  readonly version: string;
  readonly source: ModuleSource['source'];
  /** Path relative to root, POSIX separators. */
  readonly path: string;
  readonly manifest: ModuleManifest;
}

export interface SyncResult {
  readonly modules: readonly ModuleRecord[];
  readonly tables: readonly TableDef[];
  readonly permissions: readonly (PermissionDef & { module: string })[];
  readonly menu: readonly (MenuEntryDef & { module: string })[];
  readonly files: readonly string[];
}

export class SyncError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`modules:sync gagal:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'SyncError';
  }
}

export async function syncModules(opts: SyncOptions): Promise<SyncResult> {
  const root = resolve(opts.root);
  const write = opts.write ?? true;
  const problems: string[] = [];

  // ---- modules.json ----
  const modulesFile = join(root, 'modules.json');
  if (!existsSync(modulesFile)) throw new SyncError([`modules.json tidak ditemukan di ${root}`]);
  const parsedFile = modulesFileSchema.safeParse(JSON.parse(readFileSync(modulesFile, 'utf8')));
  if (!parsedFile.success) {
    throw new SyncError(
      parsedFile.error.issues.map((i) => `modules.json: ${i.path.join('.')}: ${i.message}`),
    );
  }
  const sources = parsedFile.data.modules;

  const seenNames = new Map<string, number>();
  sources.forEach((s, i) => {
    const prev = seenNames.get(s.name);
    if (prev !== undefined) {
      problems.push(
        `modules.json: modul "${s.name}" terdaftar dua kali (entri #${prev} dan #${i})`,
      );
    }
    seenNames.set(s.name, i);
  });

  const coreVersion = opts.coreVersion ?? readCoreVersion(root);
  const coreIcons = new Set(opts.coreIcons ?? readCoreIcons(root));

  // ---- per module ----
  const modules: ModuleRecord[] = [];
  const tables: TableDef[] = [];
  const permissions: (PermissionDef & { module: string })[] = [];
  const menu: (MenuEntryDef & { module: string })[] = [];

  const tableOwner = new Map<string, string>();
  const permOwner = new Map<string, string>();
  const menuOwner = new Map<string, string>();
  const hrefOwner = new Map<string, string>();

  for (const src of sources) {
    const dir = resolveModuleDir(root, src);
    const rel = relative(root, dir).split('\\').join('/');
    const tag = `modul ${src.name} (${rel})`;

    if (src.source === 'package') {
      problems.push(`${tag}: sumber "package" belum didukung di M0 — pakai local atau submodule`);
      continue;
    }
    if (!existsSync(dir)) {
      problems.push(
        src.source === 'submodule'
          ? `${tag}: folder tidak ada — jalankan \`git submodule update --init ${rel}\` (ref ${src.ref})`
          : `${tag}: folder tidak ada`,
      );
      continue;
    }

    const manifestPath = join(dir, 'module.json');
    if (!existsSync(manifestPath)) {
      problems.push(`${tag}: module.json tidak ada`);
      continue;
    }
    const parsed = moduleManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        problems.push(`${tag}: module.json: ${i.path.join('.') || '(root)'}: ${i.message}`);
      }
      continue;
    }
    const manifest = parsed.data;
    if (manifest.name !== src.name) {
      problems.push(
        `${tag}: nama di module.json ("${manifest.name}") tidak sama dengan modules.json ("${src.name}")`,
      );
      continue;
    }
    if (!satisfiesCore(coreVersion, manifest.engines.core)) {
      problems.push(`${tag}: butuh core ${manifest.engines.core}, terpasang ${coreVersion} (G-11)`);
      continue;
    }
    const ns = namespaceOf(manifest.name);
    modules.push({
      name: manifest.name,
      ns,
      version: manifest.version,
      source: src.source,
      path: rel,
      manifest,
    });

    // ---- db/tables.ts ----
    const t = await loadDefault<readonly TableDef[]>(join(dir, 'db', 'tables.ts'), problems, tag);
    if (t) {
      if (!Array.isArray(t))
        problems.push(`${tag}: db/tables.ts harus meng-export default array TableDef`);
      else {
        for (const table of t) {
          if (!table || typeof table.name !== 'string' || typeof table.columns !== 'object') {
            problems.push(
              `${tag}: db/tables.ts memuat entri yang bukan TableDef (pakai defineTable)`,
            );
            continue;
          }
          if (!table.name.startsWith(`${ns}_`)) {
            problems.push(`${tag}: tabel "${table.name}" harus diawali "${ns}_" (G-9)`);
            continue;
          }
          const owner = tableOwner.get(table.name);
          if (owner)
            problems.push(`tabel "${table.name}" didefinisikan oleh ${owner} dan ${manifest.name}`);
          else {
            tableOwner.set(table.name, manifest.name);
            tables.push(table);
          }
        }
      }
    }

    // ---- permissions.ts ----
    const p = await loadDefault<readonly PermissionDef[]>(
      join(dir, 'permissions.ts'),
      problems,
      tag,
    );
    if (p) {
      if (!Array.isArray(p))
        problems.push(`${tag}: permissions.ts harus meng-export default array`);
      else {
        for (const perm of p) {
          if (!perm?.resource?.startsWith(`${ns}.`)) {
            problems.push(`${tag}: resource izin "${perm?.resource}" harus diawali "${ns}." (G-9)`);
            continue;
          }
          const owner = permOwner.get(perm.resource);
          if (owner)
            problems.push(`resource "${perm.resource}" dimiliki ${owner} dan ${manifest.name}`);
          else {
            permOwner.set(perm.resource, manifest.name);
            permissions.push({ ...perm, module: manifest.name });
          }
        }
      }
    }

    // ---- menu.ts ----
    const m = await loadDefault<readonly MenuEntryDef[]>(join(dir, 'menu.ts'), problems, tag);
    if (m) {
      if (!Array.isArray(m)) problems.push(`${tag}: menu.ts harus meng-export default array`);
      else {
        for (const entry of m) {
          if (!entry?.id?.startsWith(`${ns}.`)) {
            problems.push(`${tag}: id menu "${entry?.id}" harus diawali "${ns}." (G-9)`);
            continue;
          }
          if (!entry.href?.startsWith(`/m/${ns}`)) {
            problems.push(`${tag}: href menu "${entry.id}" harus di bawah /m/${ns} (G-9)`);
            continue;
          }
          if (
            entry.icon !== undefined &&
            !coreIcons.has(entry.icon) &&
            !entry.icon.startsWith(`${ns}.`)
          ) {
            problems.push(
              `${tag}: ikon "${entry.icon}" pada menu "${entry.id}" bukan nama core dan bukan "${ns}.*" (L-5)`,
            );
          }
          const owner = menuOwner.get(entry.id);
          if (owner) problems.push(`id menu "${entry.id}" dipakai ${owner} dan ${manifest.name}`);
          else {
            menuOwner.set(entry.id, manifest.name);
            const hrefO = hrefOwner.get(entry.href);
            if (hrefO && hrefO !== manifest.name) {
              problems.push(`href "${entry.href}" dipakai ${hrefO} dan ${manifest.name}`);
            }
            hrefOwner.set(entry.href, manifest.name);
            menu.push({ ...entry, module: manifest.name });
          }
        }
      }
    }
  }

  // ---- inter-module dependencies (G-11): must exist; order by dependency ----
  const byName = new Map(modules.map((m) => [m.name, m]));
  for (const m of modules) {
    for (const dep of m.manifest.dependencies) {
      if (!byName.has(dep))
        problems.push(`modul ${m.name}: bergantung pada "${dep}" yang tidak terpasang`);
    }
  }
  const ordered = topoSort(modules, problems);

  if (problems.length) throw new SyncError(problems);

  // ---- write ----
  const files: string[] = [];
  if (write) {
    files.push(
      await writeFile(
        join(root, 'packages/db/src/generated/module-tables.ts'),
        emitModuleTables(tables),
      ),
    );
    files.push(
      await writeFile(
        join(root, 'packages/module-kit/src/generated/registry.ts'),
        emitRegistry(ordered, permissions, menu),
      ),
    );
  }

  return { modules: ordered, tables, permissions, menu, files };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resolveModuleDir(root: string, src: ModuleSource): string {
  const p =
    src.source === 'package'
      ? join('node_modules', src.package)
      : (src.path ?? join('modules', src.name));
  return isAbsolute(p) ? p : join(root, p);
}

function readCoreVersion(root: string): string {
  try {
    return String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function readCoreIcons(root: string): string[] {
  try {
    const reg = JSON.parse(
      readFileSync(join(root, 'packages/ui-theme/icons/registry.json'), 'utf8'),
    );
    return Array.isArray(reg.core) ? reg.core : [];
  } catch {
    return [];
  }
}

/** Import a module file's default export if the file exists; report (not throw) on failure. */
async function loadDefault<T>(
  file: string,
  problems: string[],
  tag: string,
): Promise<T | undefined> {
  if (!existsSync(file)) return undefined;
  try {
    const mod = (await import(pathToFileURL(file).href)) as { default?: T };
    if (mod.default === undefined) {
      problems.push(`${tag}: ${relativeName(file)} tidak punya export default`);
      return undefined;
    }
    return mod.default;
  } catch (err) {
    problems.push(
      `${tag}: ${relativeName(file)} gagal dimuat — ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

function relativeName(file: string): string {
  return file.split('/').slice(-2).join('/');
}

function topoSort(modules: ModuleRecord[], problems: string[]): ModuleRecord[] {
  const byName = new Map(modules.map((m) => [m.name, m]));
  const state = new Map<string, 'visiting' | 'done'>();
  const out: ModuleRecord[] = [];
  const visit = (m: ModuleRecord, trail: string[]): void => {
    const s = state.get(m.name);
    if (s === 'done') return;
    if (s === 'visiting') {
      problems.push(`dependensi melingkar: ${[...trail, m.name].join(' → ')}`);
      return;
    }
    state.set(m.name, 'visiting');
    for (const dep of m.manifest.dependencies) {
      const d = byName.get(dep);
      if (d) visit(d, [...trail, m.name]);
    }
    state.set(m.name, 'done');
    out.push(m);
  };
  for (const m of [...modules].sort((a, b) => a.name.localeCompare(b.name))) visit(m, []);
  return out;
}

async function writeFile(path: string, content: string): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true });
  await Bun.write(path, content);
  return path;
}

const GEN_HEADER = `// GENERATED by \`bun modules:sync\` from modules.json — DO NOT edit by hand.
/* biome-ignore-all lint: generated file */
`;

function emitModuleTables(tables: readonly TableDef[]): string {
  return `${GEN_HEADER}import type { TableDef } from '../descriptor.ts';

/** Tables contributed by installed modules; merged with core tables by db:codegen (O-1). */
export const moduleTables: readonly TableDef[] = ${JSON.stringify(tables, null, 2)};
`;
}

function emitRegistry(
  modules: readonly ModuleRecord[],
  permissions: readonly (PermissionDef & { module: string })[],
  menu: readonly (MenuEntryDef & { module: string })[],
): string {
  const mods = modules.map(({ name, ns, version, source, path }) => ({
    name,
    ns,
    version,
    source,
    path,
  }));
  return `${GEN_HEADER}import type { MenuEntryDef, PermissionDef } from '../contract.ts';

/** Installed modules in initialisation order (dependencies first). */
export const modules = ${JSON.stringify(mods, null, 2)} as const;

/** Permissions registered by modules — feeds the RBAC resource registry (C-4). */
export const modulePermissions: readonly (PermissionDef & { module: string })[] = ${JSON.stringify(permissions, null, 2)};

/** Menu entries contributed by modules — merged with core menu and filtered by permission (F-1). */
export const moduleMenu: readonly (MenuEntryDef & { module: string })[] = ${JSON.stringify(menu, null, 2)};
`;
}
