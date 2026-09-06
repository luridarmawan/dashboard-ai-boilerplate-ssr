import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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

/** A module that ships `api/routes.ts` — mounted under `/v1/m/<ns>` (extension point 2). */
export interface ApiModuleRecord {
  readonly name: string;
  readonly ns: string;
  /** Module-relative path of the routes file, POSIX. */
  readonly file: string;
}

/** One file under a module's `web/routes/**`, mirrored as a shim into the web app (extension point 3). */
export interface WebRouteRecord {
  readonly module: string;
  readonly ns: string;
  /** Path relative to root of the module's original file. */
  readonly from: string;
  /** Path relative to root of the generated shim. */
  readonly to: string;
  readonly kind: 'svelte' | 'ts';
}

export interface SyncResult {
  readonly modules: readonly ModuleRecord[];
  readonly tables: readonly TableDef[];
  readonly permissions: readonly (PermissionDef & { module: string })[];
  readonly menu: readonly (MenuEntryDef & { module: string })[];
  readonly apiModules: readonly ApiModuleRecord[];
  readonly webRoutes: readonly WebRouteRecord[];
  readonly files: readonly string[];
  /** Non-fatal findings, e.g. a submodule with local modifications (§4.9 point 5). */
  readonly warnings: readonly string[];
}

export class SyncError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`modules:sync gagal:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'SyncError';
  }
}

const WEB_ROUTE_FILES = new Set([
  '+page.svelte',
  '+page.ts',
  '+page.server.ts',
  '+layout.svelte',
  '+layout.ts',
  '+layout.server.ts',
  '+error.svelte',
  '+server.ts',
]);

/** Written into the generated web route dir; sync refuses to wipe a dir that lacks it. */
const WEB_MARKER = '.generated-by-modules-sync';

export async function syncModules(opts: SyncOptions): Promise<SyncResult> {
  const root = resolve(opts.root);
  const write = opts.write ?? true;
  const problems: string[] = [];
  const warnings: string[] = [];

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
  const apiModules: ApiModuleRecord[] = [];
  const webRoutes: WebRouteRecord[] = [];

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
    if (src.source === 'submodule') {
      // G-10: a submodule may be un-initialised on a fresh clone — bring it in, then make sure
      // the checkout is exactly the pinned ref. A drifted checkout is an error, not a warning:
      // modules.json must be enough to reproduce the build (Q-5).
      if (!existsSync(dir) || readdirSync(dir).length === 0) {
        const init = git(root, ['submodule', 'update', '--init', '--', rel]);
        if (!init.ok) {
          problems.push(`${tag}: submodule gagal di-init dari ${src.repo} — ${init.out}`);
          continue;
        }
      }
      const want = git(dir, ['rev-parse', '--verify', `${src.ref}^{commit}`]);
      const have = git(dir, ['rev-parse', 'HEAD']);
      if (!want.ok || !have.ok) {
        problems.push(
          `${tag}: tidak bisa memverifikasi ref "${src.ref}" — ${want.out || have.out}`,
        );
        continue;
      }
      if (want.out !== have.out) {
        problems.push(
          `${tag}: terkunci pada ${src.ref} (${want.out.slice(0, 12)}) tapi checkout di ${have.out.slice(0, 12)} — jalankan \`git -C ${rel} checkout ${src.ref}\` atau perbarui ref di modules.json`,
        );
        continue;
      }
      const dirty = git(dir, ['status', '--porcelain', '--untracked-files=normal']);
      if (dirty.ok && dirty.out.length > 0) {
        warnings.push(
          `${tag}: folder submodule dimodifikasi lokal — ubah di repo asalnya, bukan di sini (§4.9 poin 5):\n      ${dirty.out.split('\n').slice(0, 5).join('\n      ')}`,
        );
      }
    } else if (!existsSync(dir)) {
      problems.push(`${tag}: folder tidak ada`);
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

    // ---- db/tables.ts (extension point 1) ----
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

    // ---- permissions.ts (extension point 5) ----
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

    // ---- menu.ts (extension point 4) ----
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

    // ---- api/routes.ts (extension point 2) ----
    const routesFile = join(dir, 'api', 'routes.ts');
    const r = await loadDefault<unknown>(routesFile, problems, tag);
    if (r !== undefined) {
      if (!looksLikeElysia(r)) {
        problems.push(
          `${tag}: api/routes.ts harus meng-export default instance Elysia (pakai defineApiRoutes)`,
        );
      } else {
        apiModules.push({ name: manifest.name, ns, file: 'api/routes.ts' });
      }
    }

    // ---- web/routes/** (extension point 3) ----
    const webDir = join(dir, 'web', 'routes');
    if (existsSync(webDir)) {
      for (const file of walk(webDir)) {
        const base = file.split('/').pop() ?? '';
        if (!WEB_ROUTE_FILES.has(base)) continue;
        const relInRoutes = relative(webDir, file).split('\\').join('/');
        webRoutes.push({
          module: manifest.name,
          ns,
          from: relative(root, file).split('\\').join('/'),
          to: `apps/web/src/routes/m/${ns}/${relInRoutes}`,
          kind: base.endsWith('.svelte') ? 'svelte' : 'ts',
        });
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
    if (existsSync(join(root, 'apps/api'))) {
      const out = join(root, 'apps/api/src/generated/modules.ts');
      files.push(await writeFile(out, emitApiModules(apiModules, ordered, root, out)));
    }
    if (existsSync(join(root, 'apps/web/src/routes'))) {
      const mDir = join(root, 'apps/web/src/routes/m');
      resetGeneratedDir(mDir);
      for (const wr of webRoutes) {
        const to = join(root, wr.to);
        const from = join(root, wr.from);
        files.push(
          await writeFile(to, wr.kind === 'svelte' ? svelteShim(from, to) : tsShim(from, to)),
        );
      }
    }
  }

  return { modules: ordered, tables, permissions, menu, apiModules, webRoutes, files, warnings };
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

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const out = (p.exitCode === 0 ? p.stdout : p.stderr).toString().trim();
  return { ok: p.exitCode === 0, out };
}

/** Duck-typed so module-kit does not depend on elysia: an instance has `routes[]` and `handle()`. */
function looksLikeElysia(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as { routes?: unknown; handle?: unknown };
  return Array.isArray(o.routes) && typeof o.handle === 'function';
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
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
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
  return path;
}

/**
 * The generated web route dir is wiped on every sync so removed modules leave no orphan
 * routes (§8 #14). It is only ever wiped when it carries the marker — a hand-made `m/`
 * dir is never touched.
 */
function resetGeneratedDir(dir: string): void {
  if (existsSync(dir)) {
    if (!existsSync(join(dir, WEB_MARKER))) {
      throw new SyncError([
        `${dir} ada tapi bukan hasil generate (tanpa ${WEB_MARKER}) — pindahkan dulu; direktori ini milik modules:sync`,
      ]);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  // Marker written even when there are no web routes, so the next sync may wipe it again.
  Bun.write(
    join(dir, WEB_MARKER),
    'Generated by `bun modules:sync`. Do not edit; do not commit.\n',
  );
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

/**
 * Static composition: every module plugin is mounted under `/v1/m/<ns>` at build time, so
 * module routes are typed end-to-end (Eden, N-3) and appear in OpenAPI (N-2). A module can
 * never escape its prefix — the mount point is decided here, not in the module.
 */
export function emitApiModules(
  apiModules: readonly ApiModuleRecord[],
  ordered: readonly ModuleRecord[],
  root: string,
  outFile: string,
): string {
  const byName = new Map(ordered.map((m) => [m.name, m]));
  const imports: string[] = [];
  const mounts: string[] = [];
  for (const am of apiModules) {
    const mod = byName.get(am.name);
    if (!mod) continue;
    const abs = join(root, mod.path, am.file);
    let rel = relative(dirname(outFile), abs).split('\\').join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    const ident = `mod_${am.ns.replace(/[^a-z0-9]/g, '_')}`;
    imports.push(`import ${ident} from '${rel}';`);
    mounts.push(`  .group('/m/${am.ns}', (g) => g.use(${ident}))`);
  }
  return `${GEN_HEADER}import { Elysia } from 'elysia';
${imports.join('\n')}

/** All module APIs, each under /v1/m/<ns> (G-9). Mounted by apps/api inside the /v1 group. */
export const modulesPlugin = new Elysia({ name: 'modules' })
${mounts.join('\n')};

export const mountedModules = ${JSON.stringify(apiModules.map((a) => a.ns))} as const;
`;
}

/** `+page.svelte` / `+layout.svelte` / `+error.svelte` shim: render the module's component. */
export function svelteShim(from: string, to: string): string {
  const rel = importPath(from, to);
  const isLayout = from.endsWith('+layout.svelte');
  return `<!-- GENERATED by \`bun modules:sync\` — DO NOT edit; the source is ${rel} -->
<script lang="ts">
  import Component from '${rel}';
  let props = $props();
</script>

${isLayout ? '<Component {...props}>{@render props.children?.()}</Component>' : '<Component {...props} />'}
`;
}

/** `+page.server.ts` / `+page.ts` / `+server.ts` shim: re-export load, actions, handlers. */
export function tsShim(from: string, to: string): string {
  const rel = importPath(from, to);
  return `${GEN_HEADER}export * from '${rel}';
`;
}

function importPath(from: string, to: string): string {
  let rel = relative(dirname(to), from).split('\\').join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}
