import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TableDef } from '@core/db/descriptor';
import type {
  ConfigSectionDef,
  IconSetContribDef,
  LayoutContribDef,
  MenuEntryDef,
  PermissionDef,
  PublicRouteDef,
  WidgetDef,
} from './contract.ts';
import { CORE_EVENTS } from './events.ts';
import { parseEvery } from './jobs.ts';
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

/** A module that ships `hooks.ts` (extension point 9) or `jobs.ts` (extension point 12). */
export interface RuntimeModuleRecord {
  readonly name: string;
  readonly ns: string;
  /** Module-relative file, POSIX. */
  readonly file: string;
  /** Event names (hooks) or job names (jobs) declared — for the registry and the admin UI. */
  readonly items: readonly string[];
}

export interface SyncResult {
  readonly modules: readonly ModuleRecord[];
  readonly tables: readonly TableDef[];
  readonly permissions: readonly (PermissionDef & { module: string })[];
  readonly menu: readonly (MenuEntryDef & { module: string })[];
  readonly apiModules: readonly ApiModuleRecord[];
  readonly webRoutes: readonly WebRouteRecord[];
  readonly hookModules: readonly RuntimeModuleRecord[];
  readonly jobModules: readonly RuntimeModuleRecord[];
  readonly files: readonly string[];
  /** Non-fatal findings, e.g. a submodule with local modifications (§4.9 point 5). */
  readonly warnings: readonly string[];
  /** Module translation keys merged into the catalogue (K-6). */
  readonly i18nKeys: number;
  readonly widgets: readonly (WidgetDef & { module: string; path: string })[];
  readonly layoutsContrib: readonly (LayoutContribDef & { module: string; path: string })[];
  readonly iconSetsContrib: readonly (IconSetContribDef & { module: string; path: string })[];
  readonly themesContrib: readonly ThemeContrib[];
  readonly configSections: readonly (ConfigSectionDef & { module: string })[];
  readonly publicRoutes: readonly (PublicRouteDef & { module: string; ns: string })[];
}

/** A theme folder contributed by a module (extension point 14). */
export interface ThemeContrib {
  readonly manifest: {
    id: string;
    name: { id: string; en: string };
    description?: { id: string; en: string };
    tokens?: string;
    icons: string;
    layouts?: Record<string, Record<string, string>>;
    assets?: Record<string, string>;
    preview?: string;
  };
  readonly module: string;
  readonly dir: string;
  readonly tokensPath: string;
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
/** Supported locales (K-1). Adding one = a new JSON file in packages/i18n/messages + this list. */
export const I18N_LOCALES = ['id', 'en'] as const;

export async function syncModules(opts: SyncOptions): Promise<SyncResult> {
  const root = resolve(opts.root);
  const write = opts.write ?? true;
  // Fresh checkout: module files imported below (api/routes.ts → @app/api/services → the generated
  // registry) must resolve BEFORE the first sync has written anything. Placeholders break the loop;
  // the real content overwrites them at the end of this run.
  if (write) ensureGeneratedPlaceholders(root);
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
  const hookModules: RuntimeModuleRecord[] = [];
  const jobModules: RuntimeModuleRecord[] = [];
  const jobOwner = new Map<string, string>();
  // Extension point 7 (K-6): module messages, merged into one typed catalogue per locale.
  const i18n: Record<string, Record<string, string>> = {};
  for (const l of I18N_LOCALES) i18n[l] = {};
  const i18nOwner = new Map<string, string>();
  let i18nKeys = 0;
  const configSections: (ConfigSectionDef & { module: string })[] = [];
  const configKeyOwner = new Map<string, string>();
  const publicRoutes: (PublicRouteDef & { module: string; ns: string })[] = [];
  const publicOwner = new Map<string, string>();
  const corePublicPaths = readCoreRoutePaths(root);
  const seedModules: { module: string; file: string }[] = [];
  const widgets: (WidgetDef & { module: string; path: string })[] = [];
  const widgetOwner = new Map<string, string>();
  // Extension points 14–16 (§4.8, L-7, L-14): themes, layouts, icon sets from modules.
  const layoutsContrib: (LayoutContribDef & { module: string; path: string })[] = [];
  const iconSetsContrib: (IconSetContribDef & { module: string; path: string })[] = [];
  const themesContrib: ThemeContrib[] = [];
  const coreLayouts = readCoreLayouts(root);
  const coreIconSets = readCoreIconSets(root);

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

    // ---- hooks.ts (extension point 9) ----
    const h = await loadDefault<{ module?: string; handlers?: Record<string, unknown> }>(
      join(dir, 'hooks.ts'),
      problems,
      tag,
    );
    if (h !== undefined) {
      if (!h || typeof h !== 'object' || typeof h.handlers !== 'object' || h.handlers === null) {
        problems.push(`${tag}: hooks.ts harus meng-export default hasil defineHooks(...)`);
      } else {
        const names = Object.keys(h.handlers);
        const unknown = names.filter((n) => !(CORE_EVENTS as readonly string[]).includes(n));
        for (const n of unknown)
          problems.push(`${tag}: hooks.ts berlangganan event "${n}" yang tidak dikenal core`);
        if (unknown.length === 0)
          hookModules.push({ name: manifest.name, ns, file: 'hooks.ts', items: names });
      }
    }

    // ---- jobs.ts (extension point 12) ----
    const j = await loadDefault<
      readonly { name?: string; every?: number | string; run?: unknown }[]
    >(join(dir, 'jobs.ts'), problems, tag);
    if (j !== undefined) {
      if (!Array.isArray(j))
        problems.push(`${tag}: jobs.ts harus meng-export default array (pakai defineJobs)`);
      else {
        const names: string[] = [];
        for (const job of j) {
          if (typeof job?.name !== 'string' || typeof job.run !== 'function') {
            problems.push(`${tag}: jobs.ts memuat entri tanpa name/run (pakai defineJobs)`);
            continue;
          }
          if (!job.name.startsWith(`${ns}.`)) {
            problems.push(`${tag}: job "${job.name}" harus diawali "${ns}." (G-9)`);
            continue;
          }
          try {
            parseEvery(job.every ?? 0);
          } catch (err) {
            problems.push(
              `${tag}: job "${job.name}": ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }
          const owner = jobOwner.get(job.name);
          if (owner)
            problems.push(`job "${job.name}" didefinisikan oleh ${owner} dan ${manifest.name}`);
          else {
            jobOwner.set(job.name, manifest.name);
            names.push(job.name);
          }
        }
        if (names.length)
          jobModules.push({ name: manifest.name, ns, file: 'jobs.ts', items: names });
      }
    }

    // ---- config.ts (extension point 6, E-3/E-8) ----
    const cfg = await loadDefault<readonly ConfigSectionDef[]>(
      join(dir, 'config.ts'),
      problems,
      tag,
    );
    if (cfg) {
      if (!Array.isArray(cfg))
        problems.push(`${tag}: config.ts harus meng-export default array (pakai defineConfig)`);
      else {
        for (const section of cfg) {
          if (section.section !== ns && !section.section?.startsWith(`${ns}.`)) {
            problems.push(
              `${tag}: section konfigurasi "${section.section}" harus "${ns}" atau diawali "${ns}." (G-9)`,
            );
            continue;
          }
          let ok = true;
          for (const f of section.fields ?? []) {
            if (!f.key?.startsWith(`${ns}.`)) {
              problems.push(`${tag}: kunci konfigurasi "${f.key}" harus diawali "${ns}." (G-9)`);
              ok = false;
              continue;
            }
            const owner = configKeyOwner.get(f.key);
            if (owner) {
              problems.push(`kunci konfigurasi "${f.key}" dimiliki ${owner} dan ${manifest.name}`);
              ok = false;
            } else configKeyOwner.set(f.key, manifest.name);
          }
          if (ok) configSections.push({ ...section, module: manifest.name });
        }
      }
    }

    // ---- seed.ts (idempotent module seed, O-3) ----
    const seedFile = join(dir, 'seed.ts');
    if (existsSync(seedFile)) {
      const sd = await loadDefault<unknown>(seedFile, problems, tag);
      if (sd !== null && typeof sd !== 'function')
        problems.push(`${tag}: seed.ts harus meng-export default fungsi (pakai defineSeed)`);
      else if (sd)
        seedModules.push({
          module: manifest.name,
          file: relative(root, seedFile).split('\\').join('/'),
        });
    }

    // ---- widgets.ts (extension point 11, G-19) ----
    const w = await loadDefault<readonly WidgetDef[]>(join(dir, 'widgets.ts'), problems, tag);
    if (w) {
      if (!Array.isArray(w))
        problems.push(`${tag}: widgets.ts harus meng-export default array (pakai defineWidgets)`);
      else {
        for (const widget of w) {
          if (!widget?.id?.startsWith(`${ns}.`)) {
            problems.push(`${tag}: id widget "${widget?.id}" harus diawali "${ns}." (G-9)`);
            continue;
          }
          if (!existsSync(join(dir, widget.component))) {
            problems.push(`${tag}: widget "${widget.id}": komponen ${widget.component} tidak ada`);
            continue;
          }
          const owner = widgetOwner.get(widget.id);
          if (owner)
            problems.push(`widget "${widget.id}" didefinisikan oleh ${owner} dan ${manifest.name}`);
          else {
            widgetOwner.set(widget.id, manifest.name);
            widgets.push({ ...widget, module: manifest.name, path: `${rel}/${widget.component}` });
          }
        }
      }
    }

    // ---- layouts.ts (extension point 15, L-7/L-8) ----
    const lay = await loadDefault<readonly LayoutContribDef[]>(
      join(dir, 'layouts.ts'),
      problems,
      tag,
    );
    if (lay) {
      if (!Array.isArray(lay))
        problems.push(`${tag}: layouts.ts harus meng-export default array (pakai defineLayouts)`);
      else {
        for (const l of lay) {
          if (!l?.id?.startsWith(`${ns}.`)) {
            problems.push(`${tag}: id layout "${l?.id}" harus diawali "${ns}." (G-9)`);
            continue;
          }
          const file = join(dir, l.component);
          if (!existsSync(file)) {
            problems.push(`${tag}: layout "${l.id}": komponen ${l.component} tidak ada`);
            continue;
          }
          const regions = coreLayouts.regions[l.kind];
          if (!regions) {
            problems.push(`${tag}: layout "${l.id}": kind "${l.kind}" tidak dikenal`);
            continue;
          }
          const src = readFileSync(file, 'utf8');
          const missing = regions.filter((r) => !new RegExp(`\\{@render\\s+${r}\\s*\\(`).test(src));
          if (missing.length) {
            problems.push(
              `${tag}: layout "${l.id}" (${l.kind}) belum mengisi region: ${missing.join(', ')} (L-8)`,
            );
            continue;
          }
          if (coreLayouts.ids.has(l.id) || layoutsContrib.some((x) => x.id === l.id)) {
            problems.push(`${tag}: layout "${l.id}" sudah ada`);
            continue;
          }
          layoutsContrib.push({ ...l, module: manifest.name, path: `${rel}/${l.component}` });
        }
      }
    }

    // ---- icons.ts (extension point 16, L-5) ----
    const ic = await loadDefault<readonly IconSetContribDef[]>(
      join(dir, 'icons.ts'),
      problems,
      tag,
    );
    if (ic) {
      if (!Array.isArray(ic))
        problems.push(`${tag}: icons.ts harus meng-export default array (pakai defineIconSets)`);
      else {
        for (const s of ic) {
          if (!s?.id?.startsWith(`${ns}.`)) {
            problems.push(`${tag}: id set ikon "${s?.id}" harus diawali "${ns}." (G-9)`);
            continue;
          }
          const file = join(dir, s.glyphs);
          if (!existsSync(file)) {
            problems.push(`${tag}: set ikon "${s.id}": berkas glyph ${s.glyphs} tidak ada`);
            continue;
          }
          const src = readFileSync(file, 'utf8');
          const keys = new Set([...src.matchAll(/^\s+'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]));
          const missing = [...coreIcons].filter((n) => !keys.has(n));
          if (missing.length) {
            problems.push(
              `${tag}: set ikon "${s.id}" tidak memetakan ${missing.length} nama core (mis. ${missing.slice(0, 3).join(', ')}) (L-5)`,
            );
            continue;
          }
          if (coreIconSets.has(s.id) || iconSetsContrib.some((x) => x.id === s.id)) {
            problems.push(`${tag}: set ikon "${s.id}" sudah ada`);
            continue;
          }
          iconSetsContrib.push({ ...s, module: manifest.name, path: `${rel}/${s.glyphs}` });
        }
      }
    }

    // ---- themes/<id>/theme.json (extension point 14) ----
    const themesDir = join(dir, 'themes');
    if (existsSync(themesDir)) {
      for (const entry of readdirSync(themesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const tdir = join(themesDir, entry.name);
        const mf = join(tdir, 'theme.json');
        if (!existsSync(mf)) continue;
        let theme: ThemeContrib['manifest'];
        try {
          theme = JSON.parse(readFileSync(mf, 'utf8'));
        } catch (e) {
          problems.push(
            `${tag}: themes/${entry.name}/theme.json tidak bisa dibaca — ${(e as Error).message}`,
          );
          continue;
        }
        if (!theme?.id?.startsWith(`${ns}.`)) {
          problems.push(`${tag}: id tema "${theme?.id}" harus diawali "${ns}." (G-9)`);
          continue;
        }
        const tokens = join(tdir, (theme.tokens ?? './tokens.css').replace(/^\.\//, ''));
        if (!existsSync(tokens)) {
          problems.push(`${tag}: tema "${theme.id}": berkas token ${theme.tokens} tidak ada`);
          continue;
        }
        themesContrib.push({
          manifest: theme,
          module: manifest.name,
          dir: `${rel}/themes/${entry.name}`,
          tokensPath: `${rel}/themes/${entry.name}/${(theme.tokens ?? './tokens.css').replace(/^\.\//, '')}`,
        });
      }
    }

    // ---- i18n/<locale>.json (extension point 7, K-6) ----
    const i18nDir = join(dir, 'i18n');
    if (existsSync(i18nDir)) {
      const perLocale: Record<string, Record<string, string>> = {};
      for (const locale of I18N_LOCALES) {
        const f = join(i18nDir, `${locale}.json`);
        if (!existsSync(f)) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(readFileSync(f, 'utf8'));
        } catch (e) {
          problems.push(`${tag}: i18n/${locale}.json tidak bisa dibaca — ${(e as Error).message}`);
          continue;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          problems.push(`${tag}: i18n/${locale}.json harus objek datar { "kunci": "teks" }`);
          continue;
        }
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v !== 'string') {
            problems.push(`${tag}: i18n/${locale}.json: "${k}" harus string`);
            continue;
          }
          if (!k.startsWith(`${ns}.`)) {
            problems.push(`${tag}: kunci terjemahan "${k}" harus diawali "${ns}." (K-6, G-9)`);
            continue;
          }
          flat[k] = v;
        }
        perLocale[locale] = flat;
      }
      const base = perLocale[I18N_LOCALES[0]] ?? {};
      for (const k of Object.keys(base)) {
        const owner = i18nOwner.get(k);
        if (owner && owner !== manifest.name) {
          problems.push(`kunci terjemahan "${k}" dimiliki ${owner} dan ${manifest.name}`);
          continue;
        }
        i18nOwner.set(k, manifest.name);
        i18nKeys++;
      }
      for (const locale of I18N_LOCALES) {
        const dict = perLocale[locale];
        if (!dict) {
          if (Object.keys(base).length)
            warnings.push(
              `${tag}: i18n/${locale}.json tidak ada — memakai fallback ${I18N_LOCALES[0]} (K-4)`,
            );
          continue;
        }
        const missing = Object.keys(base).filter((k) => !(k in dict));
        if (missing.length)
          warnings.push(
            `${tag}: i18n/${locale}.json belum menerjemahkan ${missing.length} kunci (mis. ${missing[0]})`,
          );
        for (const [k, v] of Object.entries(dict))
          if (i18nOwner.get(k) === manifest.name) (i18n[locale] as Record<string, string>)[k] = v;
      }
    }

    // ---- public.ts + web/public/** (extension point 13) ----
    const pub = await loadDefault<readonly PublicRouteDef[]>(join(dir, 'public.ts'), problems, tag);
    if (pub) {
      if (!Array.isArray(pub))
        problems.push(
          `${tag}: public.ts harus meng-export default array (pakai definePublicRoutes)`,
        );
      else {
        for (const r of pub) {
          if (!r?.path?.startsWith('/') || r.path.startsWith('/m/')) {
            problems.push(`${tag}: route publik "${r?.path}" tidak valid`);
            continue;
          }
          const pdir = join(dir, r.dir);
          if (!existsSync(join(pdir, '+page.svelte'))) {
            problems.push(`${tag}: route publik "${r.path}": ${r.dir}/+page.svelte tidak ada`);
            continue;
          }
          if (corePublicPaths.has(r.path)) {
            problems.push(
              `${tag}: route publik "${r.path}" bentrok dengan halaman core (titik perluasan 13)`,
            );
            continue;
          }
          const owner = publicOwner.get(r.path);
          if (owner) {
            problems.push(`route publik "${r.path}" diklaim ${owner} dan ${manifest.name}`);
            continue;
          }
          publicOwner.set(r.path, manifest.name);
          publicRoutes.push({ ...r, module: manifest.name, ns });
          for (const file of walk(pdir)) {
            const base = basename(file);
            if (!WEB_ROUTE_FILES.has(base)) continue;
            const relIn = relative(pdir, file).split('\\').join('/');
            webRoutes.push({
              module: manifest.name,
              ns,
              from: relative(root, file).split('\\').join('/'),
              to: `apps/web/src/routes/(public)/(modules)${r.path}/${relIn}`,
              kind: base.endsWith('.svelte') ? 'svelte' : 'ts',
            });
          }
        }
      }
    }

    // ---- web/routes/** (extension point 3) ----
    const webDir = join(dir, 'web', 'routes');
    if (existsSync(webDir)) {
      for (const file of walk(webDir)) {
        const base = basename(file);
        if (!WEB_ROUTE_FILES.has(base)) continue;
        const relInRoutes = relative(webDir, file).split('\\').join('/');
        webRoutes.push({
          module: manifest.name,
          ns,
          from: relative(root, file).split('\\').join('/'),
          // Dashboard pages: inside the (app) group → session required, shell + theme applied (§4.8).
          to: `apps/web/src/routes/(app)/m/${ns}/${relInRoutes}`,
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
  // Themes may reference core OR module layouts / icon sets — but only ones that exist (L-8, L-5).
  const knownLayouts = new Map<string, string>([...coreLayouts.kinds]);
  for (const l of layoutsContrib) knownLayouts.set(l.id, l.kind);
  const knownIconSets = new Set([...coreIconSets, ...iconSetsContrib.map((s) => s.id)]);
  for (const th of themesContrib) {
    const m = th.manifest;
    if (!knownIconSets.has(m.icons))
      problems.push(`tema "${m.id}": set ikon "${m.icons}" tidak terdaftar (L-5)`);
    for (const [kind, variants] of Object.entries(m.layouts ?? {})) {
      if (!variants?.default)
        problems.push(`tema "${m.id}"/${kind}: varian "default" wajib ada (Keputusan K)`);
      for (const [variant, layoutId] of Object.entries(variants ?? {})) {
        const k = knownLayouts.get(layoutId);
        if (!k)
          problems.push(
            `tema "${m.id}"/${kind}/${variant}: layout "${layoutId}" tidak terdaftar (L-8)`,
          );
        else if (k !== kind)
          problems.push(`tema "${m.id}"/${kind}/${variant}: layout "${layoutId}" ber-kind "${k}"`);
      }
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
        emitRegistry(ordered, permissions, menu, configSections),
      ),
    );
    files.push(
      await writeFile(
        join(root, 'packages/i18n/src/generated/messages.ts'),
        emitMessages(root, i18n),
      ),
    );
    if (existsSync(join(root, 'apps/api'))) {
      const out = join(root, 'apps/api/src/generated/modules.ts');
      files.push(
        await writeFile(
          out,
          emitApiModules(apiModules, ordered, root, out, hookModules, jobModules),
        ),
      );
    }
    const seedsOut = join(root, 'packages/module-kit/src/generated/seeds.ts');
    files.push(await writeFile(seedsOut, emitSeeds(seedModules, root, seedsOut)));
    files.push(
      await writeFile(
        join(root, 'packages/ui-theme/src/generated/contrib.ts'),
        emitThemeContrib(themesContrib, layoutsContrib, iconSetsContrib),
      ),
    );
    if (existsSync(join(root, 'apps/web/src/routes'))) {
      const lOut = join(root, 'apps/web/src/generated/layouts.ts');
      files.push(await writeFile(lOut, emitLayouts(layoutsContrib, root, lOut)));
      const iOut = join(root, 'apps/web/src/generated/icon-sets.ts');
      files.push(await writeFile(iOut, emitIconSets(iconSetsContrib, root, iOut)));
      const cOut = join(root, 'apps/web/src/generated/themes.css');
      files.push(await writeFile(cOut, emitThemesCss(themesContrib, root, cOut)));
      const tOut = join(root, 'apps/web/src/generated/theme-tokens.ts');
      files.push(await writeFile(tOut, emitThemeTokens(themesContrib, root, tOut)));
      files.push(
        await writeFile(
          join(root, 'apps/web/src/generated/public-routes.ts'),
          emitPublicRoutes(publicRoutes),
        ),
      );
      const wOut = join(root, 'apps/web/src/generated/widgets.ts');
      files.push(await writeFile(wOut, emitWidgets(widgets, root, wOut)));
      const legacy = join(root, 'apps/web/src/routes/m');
      if (existsSync(join(legacy, WEB_MARKER))) rmSync(legacy, { recursive: true, force: true });
      resetGeneratedDir(join(root, 'apps/web/src/routes/(app)/m'));
      resetGeneratedDir(join(root, 'apps/web/src/routes/(public)/(modules)'));
      for (const wr of webRoutes) {
        const to = join(root, wr.to);
        const from = join(root, wr.from);
        files.push(
          await writeFile(to, wr.kind === 'svelte' ? svelteShim(from, to) : tsShim(from, to)),
        );
      }
    }
  }

  return {
    i18nKeys,
    widgets,
    configSections,
    publicRoutes,
    layoutsContrib,
    iconSetsContrib,
    themesContrib,
    modules: ordered,
    tables,
    permissions,
    menu,
    apiModules,
    webRoutes,
    hookModules,
    jobModules,
    files,
    warnings,
  };
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
  config: readonly (ConfigSectionDef & { module: string })[] = [],
): string {
  const mods = modules.map(({ name, ns, version, source, path }) => ({
    name,
    ns,
    version,
    source,
    path,
  }));
  return `${GEN_HEADER}import type { ConfigSectionDef, MenuEntryDef, PermissionDef } from '../contract.ts';

/** Installed modules in initialisation order (dependencies first). */
export const modules = ${JSON.stringify(mods, null, 2)} as const;

/** Permissions registered by modules — feeds the RBAC resource registry (C-4). */
export const modulePermissions: readonly (PermissionDef & { module: string })[] = ${JSON.stringify(permissions, null, 2)};

/** Menu entries contributed by modules — merged with core menu and filtered by permission (F-1). */
export const moduleMenu: readonly (MenuEntryDef & { module: string })[] = ${JSON.stringify(menu, null, 2)};

/** Configuration sections contributed by modules (extension point 6). */
export const moduleConfig: readonly (ConfigSectionDef & { module: string })[] = ${JSON.stringify(config, null, 2)};
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
  hookModules: readonly RuntimeModuleRecord[] = [],
  jobModules: readonly RuntimeModuleRecord[] = [],
): string {
  const byName = new Map(ordered.map((m) => [m.name, m]));
  const imports: string[] = [];
  const mounts: string[] = [];
  const relTo = (name: string, file: string): string => {
    const mod = byName.get(name);
    if (!mod) return '';
    let rel = relative(dirname(outFile), join(root, mod.path, file))
      .split('\\')
      .join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
  };
  const hookIdents: string[] = [];
  for (const hm of hookModules) {
    const ident = `hooks_${hm.ns.replace(/[^a-z0-9]/g, '_')}`;
    imports.push(`import ${ident} from '${relTo(hm.name, hm.file)}';`);
    hookIdents.push(ident);
  }
  const jobEntries: string[] = [];
  for (const jm of jobModules) {
    const ident = `jobs_${jm.ns.replace(/[^a-z0-9]/g, '_')}`;
    imports.push(`import ${ident} from '${relTo(jm.name, jm.file)}';`);
    jobEntries.push(`  { module: '${jm.name}', jobs: ${ident} },`);
  }
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

/** Event subscriptions declared by modules (G-17), in initialisation order. */
export const moduleHooks = [${hookIdents.join(', ')}];

/** Periodic jobs declared by modules (G-18); the core scheduler registers them at boot. */
export const moduleJobs = [
${jobEntries.join('\n')}
];
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

/**
 * One typed catalogue per locale: core messages (packages/i18n/messages/<locale>.json) merged
 * with every module's. `as const` makes `MessageKey` the union of ALL keys (K-5).
 */
function emitMessages(root: string, modules: Record<string, Record<string, string>>): string {
  const merged: Record<string, Record<string, string>> = {};
  for (const locale of I18N_LOCALES) {
    const coreFile = join(root, 'packages/i18n/messages', `${locale}.json`);
    const core = existsSync(coreFile)
      ? (JSON.parse(readFileSync(coreFile, 'utf8')) as Record<string, string>)
      : {};
    merged[locale] = { ...core, ...(modules[locale] ?? {}) };
  }
  const first = I18N_LOCALES[0];
  return `${GEN_HEADER}
export const LOCALES = ${JSON.stringify(I18N_LOCALES)} as const;
export type Locale = (typeof LOCALES)[number];

/** Core + module messages per locale (K-6). Only the active locale is sent to the browser. */
export const messages = ${JSON.stringify(merged, null, 2)} as const;

/** Every key that exists in the ${first} catalogue — a typo is a type error (K-5). */
export type MessageKey = keyof (typeof messages)['${first}'] & string;
`;
}

/**
 * Dashboard widget registry for the web app (G-19): metadata for the server-side permission
 * filter, and a lazy loader per widget so only the widgets a user may see are downloaded.
 */
function emitWidgets(
  widgets: readonly (WidgetDef & { module: string; path: string })[],
  root: string,
  out: string,
): string {
  const entries = widgets.map((w) => {
    const from = join(root, w.path);
    const { module: _m, path: _p, ...meta } = w;
    return `  {\n    ...${JSON.stringify({ ...meta, module: w.module })},\n    load: () => import('${importPath(from, out)}'),\n  },`;
  });
  return `${GEN_HEADER}import type { Component } from 'svelte';

export interface WidgetEntry {
  readonly id: string;
  readonly title: { readonly id: string; readonly en: string };
  readonly component: string;
  readonly permission?: string;
  readonly order?: number;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly module: string;
  readonly load: () => Promise<{ default: Component<Record<string, unknown>> }>;
}

/** Widgets contributed by modules (extension point 11), in module initialisation order. */
export const moduleWidgets: readonly WidgetEntry[] = [
${entries.join('\n')}
];
`;
}

function readCoreLayouts(root: string): {
  ids: Set<string>;
  kinds: Map<string, string>;
  regions: Record<string, string[]>;
} {
  const file = join(root, 'packages/ui-theme/layouts/registry.json');
  if (!existsSync(file)) return { ids: new Set(), kinds: new Map(), regions: {} };
  const reg = JSON.parse(readFileSync(file, 'utf8')) as {
    regions: Record<string, string[]>;
    layouts: { id: string; kind: string }[];
  };
  return {
    ids: new Set(reg.layouts.map((l) => l.id)),
    kinds: new Map(reg.layouts.map((l) => [l.id, l.kind])),
    regions: reg.regions,
  };
}

function readCoreIconSets(root: string): Set<string> {
  const file = join(root, 'packages/ui-theme/icons/registry.json');
  if (!existsSync(file)) return new Set();
  return new Set(Object.keys((JSON.parse(readFileSync(file, 'utf8')) as { sets: object }).sets));
}

/** Metadata for the @core/ui-theme registry: module themes, layouts and icon sets (L-14). */
function emitThemeContrib(
  themes: readonly ThemeContrib[],
  layouts: readonly (LayoutContribDef & { module: string })[],
  iconSets: readonly (IconSetContribDef & { module: string })[],
): string {
  return `${GEN_HEADER}
/** Themes contributed by modules (extension point 14). */
export const moduleThemes = ${JSON.stringify(
    themes.map((t) => ({ ...t.manifest, module: t.module })),
    null,
    2,
  )};

/** Layouts contributed by modules (extension point 15). */
export const moduleLayouts = ${JSON.stringify(
    layouts.map(({ id, kind, name, description, module }) => ({
      id,
      kind,
      name,
      description,
      module,
    })),
    null,
    2,
  )};

/** Icon sets contributed by modules (extension point 16). */
export const moduleIconSets = ${JSON.stringify(
    iconSets.map(({ id, name, style, strokeWidth, grid, source, license, module }) => ({
      id,
      name,
      style,
      strokeWidth,
      grid: grid ?? 24,
      source: source ?? module,
      license: license ?? '',
      module,
    })),
    null,
    2,
  )};
`;
}

/** Lazy component per module layout, grouped by kind — merged into the web layout registry. */
function emitLayouts(
  layouts: readonly (LayoutContribDef & { module: string; path: string })[],
  root: string,
  out: string,
): string {
  const byKind = (kind: string) =>
    layouts
      .filter((l) => l.kind === kind)
      .map((l) => `  '${l.id}': () => import('${importPath(join(root, l.path), out)}'),`)
      .join('\n');
  return `${GEN_HEADER}
/** Module layouts (extension point 15), keyed by id. Only the resolved layout is downloaded. */
export const moduleDashboardLayouts = {
${byKind('dashboard')}
} as const;
export const modulePublicLayouts = {
${byKind('public')}
} as const;
export const moduleAuthLayouts = {
${byKind('auth')}
} as const;
`;
}

/** Glyph maps of module icon sets, imported statically so `<Icon>` can resolve them. */
function emitIconSets(
  sets: readonly (IconSetContribDef & { module: string; path: string })[],
  root: string,
  out: string,
): string {
  const imports = sets
    .map((s, i) => `import { glyphs as set${i} } from '${importPath(join(root, s.path), out)}';`)
    .join('\n');
  const entries = sets.map((s, i) => `  '${s.id}': set${i},`).join('\n');
  return `${GEN_HEADER}${imports ? `${imports}\n` : ''}
/** Module icon sets (extension point 16): id → glyph map. */
export const moduleIconGlyphs = {
${entries}
} as const;
`;
}

/** One @import per module theme token file, pulled into app.css. */
function emitThemesCss(themes: readonly ThemeContrib[], root: string, out: string): string {
  const lines = themes.map((t) => `@import '${importPath(join(root, t.tokensPath), out)}';`);
  return `/* GENERATED by \`bun modules:sync\` — module theme tokens (extension point 14). DO NOT edit. */\n${lines.join('\n')}\n`;
}

/** Raw token CSS per module theme, for the picker's generated previews. */
function emitThemeTokens(themes: readonly ThemeContrib[], root: string, out: string): string {
  const imports = themes
    .map((t, i) => `import tokens${i} from '${importPath(join(root, t.tokensPath), out)}?raw';`)
    .join('\n');
  const entries = themes.map((t, i) => `  '${t.manifest.id}': tokens${i},`).join('\n');
  return `${GEN_HEADER}${imports ? `${imports}\n` : ''}
/** Module theme id → its tokens.css source (extension point 14). */
export const moduleThemeTokens: Readonly<Record<string, string>> = {
${entries}
};
`;
}

/** Core page paths (groups stripped) for public-route collision checks; generated dirs excluded. */
function readCoreRoutePaths(root: string): Set<string> {
  const routes = join(root, 'apps/web/src/routes');
  const out = new Set<string>();
  if (!existsSync(routes)) return out;
  for (const file of walk(routes)) {
    if (!file.endsWith('/+page.svelte')) continue;
    const rel = relative(routes, dirname(file)).split('\\').join('/');
    if (rel.includes('(modules)') || /(^|\/)m(\/|$)/.test(rel.replace('(app)/', ''))) continue;
    const path = `/${rel}`.replace(/\/\([^)]+\)/g, '').replace(/^\/+/, '/');
    out.add(path === '' ? '/' : path);
  }
  return out;
}

/** Public routes contributed by modules (extension point 13): path → owning module, for G-8 and the sitemap. */
function emitPublicRoutes(
  routes: readonly (PublicRouteDef & { module: string; ns: string })[],
): string {
  return `${GEN_HEADER}
/** Module public routes: SvelteKit path, owning module namespace, sitemap flag (F-7, G-8). */
export const modulePublicRoutes: readonly { path: string; module: string; ns: string; sitemap: boolean }[] = ${JSON.stringify(
    routes.map((r) => ({
      path: r.path,
      module: r.module,
      ns: r.ns,
      sitemap: r.sitemap ?? !r.path.includes('['),
    })),
    null,
    2,
  )};
`;
}

/** Module seeds in init order, imported statically so `bun db:seed` runs them after the core seed. */
function emitSeeds(
  seeds: readonly { module: string; file: string }[],
  root: string,
  out: string,
): string {
  const imports = seeds
    .map((s, i) => `import seed${i} from '${importPath(join(root, s.file), out)}';`)
    .join('\n');
  const entries = seeds.map((s, i) => `  { module: '${s.module}', run: seed${i} },`).join('\n');
  return `${GEN_HEADER}import type { ModuleSeed } from '../contract.ts';
${imports ? `${imports}\n` : ''}
/** Idempotent module seeds (O-3), run by \`bun db:seed\` after the core seed. */
export const moduleSeeds: readonly { module: string; run: ModuleSeed }[] = [
${entries}
];
`;
}

/** Minimal generated files so imports resolve on a fresh checkout; real content replaces them below. */
function ensureGeneratedPlaceholders(root: string): void {
  const H = `${GEN_HEADER}// placeholder until the first modules:sync completes\n`;
  const files: Record<string, string> = {
    'packages/module-kit/src/generated/registry.ts': `${H}import type { ConfigSectionDef, MenuEntryDef, PermissionDef } from '../contract.ts';
export const modules = [] as const;
export const modulePermissions: readonly (PermissionDef & { module: string })[] = [];
export const moduleMenu: readonly (MenuEntryDef & { module: string })[] = [];
export const moduleConfig: readonly (ConfigSectionDef & { module: string })[] = [];
`,
    'packages/module-kit/src/generated/seeds.ts': `${H}import type { ModuleSeed } from '../contract.ts';
export const moduleSeeds: readonly { module: string; run: ModuleSeed }[] = [];
`,
    'packages/i18n/src/generated/messages.ts': `${H}export const LOCALES = ${JSON.stringify(I18N_LOCALES)} as const;
export type Locale = (typeof LOCALES)[number];
export const messages = { id: {}, en: {} } as const;
export type MessageKey = keyof (typeof messages)['id'] & string;
`,
    'packages/ui-theme/src/generated/contrib.ts': `${H}export const moduleThemes: never[] = [];
export const moduleLayouts: never[] = [];
export const moduleIconSets: never[] = [];
`,
    'packages/settings/src/generated/routes.ts': `${H}export const webRoutes: readonly string[] = ['/', '/dashboard', '/auth/login'];
`,
    'apps/web/src/generated/routes.ts': `${H}export const webRoutes: readonly string[] = ['/', '/dashboard', '/auth/login'];
`,
    'apps/web/src/generated/layout-variants.ts': `${H}export const layoutVariants: Readonly<Record<string, string>> = {};
`,
    'apps/web/src/generated/layouts.ts': `${H}export const moduleDashboardLayouts = {} as const;
export const modulePublicLayouts = {} as const;
export const moduleAuthLayouts = {} as const;
`,
    'apps/web/src/generated/icon-sets.ts': `${H}export const moduleIconGlyphs = {} as const;
`,
    'apps/web/src/generated/theme-tokens.ts': `${H}export const moduleThemeTokens: Readonly<Record<string, string>> = {};
`,
    'apps/web/src/generated/themes.css': '/* placeholder until modules:sync runs */\n',
    'apps/web/src/generated/widgets.ts': `${H}import type { Component } from 'svelte';
export interface WidgetEntry { readonly id: string; readonly title: { readonly id: string; readonly en: string }; readonly component: string; readonly permission?: string; readonly order?: number; readonly size?: 'sm' | 'md' | 'lg'; readonly module: string; readonly load: () => Promise<{ default: Component<Record<string, unknown>> }> }
export const moduleWidgets: readonly WidgetEntry[] = [];
`,
    'apps/web/src/generated/public-routes.ts': `${H}export const modulePublicRoutes: readonly { path: string; module: string; ns: string; sitemap: boolean }[] = [];
`,
    'apps/api/src/generated/modules.ts': `${H}import { Elysia } from 'elysia';
export const modulesPlugin = new Elysia({ name: 'modules' });
export const mountedModules = [] as const;
export const moduleHooks = [];
export const moduleJobs = [];
`,
  };
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, rel);
    if (existsSync(file)) continue;
    // Only inside a real host repo — the test fixtures have no apps/ or packages/i18n.
    if (!existsSync(dirname(dirname(file))) && !rel.startsWith('packages/module-kit')) continue;
    Bun.write(file, content);
  }
}
