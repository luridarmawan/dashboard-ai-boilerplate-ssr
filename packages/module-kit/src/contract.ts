import type { TableDef } from '@core/db/descriptor';
import type { LocalizedText } from './manifest.ts';
import { namespaceOf } from './manifest.ts';

/**
 * The module contract — the shapes a module's files export (PRD §4.5).
 *
 * M0 covers the data-side extension points: tables (1), permissions (5), menu (4). The
 * remaining points (API routes, pages, config, i18n, tools, hooks, widgets, jobs, themes,
 * layouts, icon sets) are added here as their consumers land — never as ad-hoc imports.
 *
 * Every `define*` helper validates the namespace at definition time so a module author
 * gets the error where they wrote it. `modules:sync` re-validates anyway: helpers are a
 * convenience, the sync is the enforcement (G-9).
 */

export class ModuleContractError extends Error {
  override name = 'ModuleContractError';
}

/** Default actions (C-1). `manage` implies all of them. Modules may add their own verbs. */
export const CORE_ACTIONS = ['read', 'create', 'edit', 'manage'] as const;
export type CoreAction = (typeof CORE_ACTIONS)[number];

export interface PermissionDef {
  /** `<ns>.<resource>`, e.g. `example.product`. Registered into the RBAC registry (C-4). */
  readonly resource: string;
  readonly actions: readonly string[];
  readonly name: LocalizedText;
}

export interface MenuEntryDef {
  /** `<ns>.<id>` — stable key, also used for i18n and per-user state (F-8). */
  readonly id: string;
  readonly label: LocalizedText;
  /** Dashboard route — must live under `/m/<ns>` (G-9). */
  readonly href: string;
  /** Semantic icon name: a core name from icons/registry.json, or `<ns>.<name>` (L-5). */
  readonly icon?: string;
  /** `<resource>.<action>`; the entry is hidden when the user lacks it (F-1). */
  readonly permission?: string;
  /** Sort key among siblings. Core entries use 0–99; modules default to 100+. */
  readonly order?: number;
  /** Optional parent menu id for one level of nesting (F-3). */
  readonly parent?: string;
}

const RESOURCE_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
const ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;
const ACTION_RE = /^[a-z][a-z0-9_]*$/;

function requirePrefix(kind: string, value: string, prefix: string): void {
  if (!value.startsWith(prefix)) {
    throw new ModuleContractError(`${kind} "${value}" harus diawali "${prefix}" (G-9)`);
  }
}

/** Declare the permissions a module owns. `moduleName` is the folder-cased name (`Example`). */
export function definePermissions(
  moduleName: string,
  list: readonly PermissionDef[],
): readonly PermissionDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const p of list) {
    if (!RESOURCE_RE.test(p.resource)) {
      throw new ModuleContractError(`resource "${p.resource}" harus berbentuk <ns>.<nama>`);
    }
    requirePrefix('resource izin', p.resource, `${ns}.`);
    if (seen.has(p.resource)) throw new ModuleContractError(`resource "${p.resource}" duplikat`);
    seen.add(p.resource);
    if (p.actions.length === 0) {
      throw new ModuleContractError(`resource "${p.resource}" tanpa action`);
    }
    for (const a of p.actions) {
      if (!ACTION_RE.test(a)) {
        throw new ModuleContractError(`action "${a}" pada "${p.resource}" tidak valid`);
      }
    }
  }
  return list;
}

/** Declare the menu entries a module contributes (extension point 4). */
export function defineMenu(
  moduleName: string,
  list: readonly MenuEntryDef[],
): readonly MenuEntryDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const m of list) {
    if (!ID_RE.test(m.id)) throw new ModuleContractError(`id menu "${m.id}" tidak valid`);
    requirePrefix('id menu', m.id, `${ns}.`);
    if (seen.has(m.id)) throw new ModuleContractError(`id menu "${m.id}" duplikat`);
    seen.add(m.id);
    requirePrefix('href menu', m.href, `/m/${ns}`);
    if (m.parent !== undefined) requirePrefix('parent menu', m.parent, `${ns}.`);
    if (m.permission !== undefined && !m.permission.startsWith(`${ns}.`)) {
      // A module may gate its menu on a core permission too — but never on another module's.
      const owner = m.permission.split('.')[0];
      if (
        owner !== undefined &&
        owner !== ns &&
        owner.length > 0 &&
        !CORE_PERMISSION_OWNERS.has(owner)
      ) {
        throw new ModuleContractError(
          `menu "${m.id}" memakai izin milik modul lain: "${m.permission}"`,
        );
      }
    }
  }
  return list;
}

/**
 * A dashboard widget (extension point 11, PRD G-19): a card the module contributes to the
 * dashboard home. Filtered by permission and rendered on the server like the menu (F-1, F-2);
 * a widget the user may not see is never sent to the browser. Placement is metadata, never a
 * change to the core page.
 */
export interface WidgetDef {
  /** `<ns>.<id>` — stable key. */
  readonly id: string;
  readonly title: LocalizedText;
  /** Svelte component path relative to the module folder, e.g. `web/widgets/Summary.svelte`. */
  readonly component: string;
  /** `<resource>.<action>`; the widget is dropped when the user lacks it (G-19). */
  readonly permission?: string;
  /** Sort key on the dashboard grid. Core uses 0–99; modules default to 100+. */
  readonly order?: number;
  /** Grid span: sm = 1 column, md = 2, lg = full row. */
  readonly size?: 'sm' | 'md' | 'lg';
}

/** Declare the dashboard widgets a module contributes (extension point 11). */
export function defineWidgets(
  moduleName: string,
  list: readonly WidgetDef[],
): readonly WidgetDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const w of list) {
    if (!ID_RE.test(w.id)) throw new ModuleContractError(`id widget "${w.id}" tidak valid`);
    requirePrefix('id widget', w.id, `${ns}.`);
    if (seen.has(w.id)) throw new ModuleContractError(`id widget "${w.id}" duplikat`);
    seen.add(w.id);
    if (
      !w.component.startsWith('web/') ||
      !w.component.endsWith('.svelte') ||
      w.component.includes('..')
    ) {
      throw new ModuleContractError(
        `widget "${w.id}": component harus berkas .svelte di dalam web/ modul, mis. web/widgets/Summary.svelte`,
      );
    }
    if (w.permission !== undefined) {
      const owner = w.permission.split('.')[0];
      if (owner && owner !== ns && !CORE_PERMISSION_OWNERS.has(owner)) {
        throw new ModuleContractError(
          `widget "${w.id}" memakai izin milik modul lain: "${w.permission}"`,
        );
      }
    }
  }
  return list;
}

/**
 * A shell layout contributed by a module (extension point 15, PRD L-7). The component fills the
 * named regions of its `kind` (checked by `modules:sync`, L-8) and may then be chosen by ANY
 * theme — including core themes — without touching core or any page.
 */
export interface LayoutContribDef {
  /** `<ns>.<id>` */
  readonly id: string;
  readonly kind: 'dashboard' | 'public' | 'auth';
  readonly name: LocalizedText;
  readonly description?: LocalizedText;
  /** Svelte component path relative to the module folder, e.g. `web/layouts/TwoColumn.svelte`. */
  readonly component: string;
}

/** Declare the layouts a module contributes (extension point 15). */
export function defineLayouts(
  moduleName: string,
  list: readonly LayoutContribDef[],
): readonly LayoutContribDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const l of list) {
    if (!ID_RE.test(l.id)) throw new ModuleContractError(`id layout "${l.id}" tidak valid`);
    requirePrefix('id layout', l.id, `${ns}.`);
    if (seen.has(l.id)) throw new ModuleContractError(`id layout "${l.id}" duplikat`);
    seen.add(l.id);
    if (!['dashboard', 'public', 'auth'].includes(l.kind)) {
      throw new ModuleContractError(`layout "${l.id}": kind harus dashboard | public | auth`);
    }
    if (
      !l.component.startsWith('web/') ||
      !l.component.endsWith('.svelte') ||
      l.component.includes('..')
    ) {
      throw new ModuleContractError(
        `layout "${l.id}": component harus berkas .svelte di dalam web/ modul`,
      );
    }
  }
  return list;
}

/**
 * An icon set contributed by a module (extension point 16, PRD L-5, L-14): a glyph map
 * (`web/icons/<set>.ts` exporting `glyphs`) that must cover every core semantic name.
 */
export interface IconSetContribDef {
  /** `<ns>.<id>` */
  readonly id: string;
  readonly name: LocalizedText;
  readonly style: 'stroke' | 'fill';
  readonly strokeWidth?: number;
  readonly grid?: number;
  readonly source?: string;
  readonly license?: string;
  /** Path to the glyph map module, relative to the module folder. */
  readonly glyphs: string;
}

/** Declare the icon sets a module contributes (extension point 16). */
export function defineIconSets(
  moduleName: string,
  list: readonly IconSetContribDef[],
): readonly IconSetContribDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const s of list) {
    if (!ID_RE.test(s.id)) throw new ModuleContractError(`id set ikon "${s.id}" tidak valid`);
    requirePrefix('id set ikon', s.id, `${ns}.`);
    if (seen.has(s.id)) throw new ModuleContractError(`id set ikon "${s.id}" duplikat`);
    seen.add(s.id);
    if (!s.glyphs.startsWith('web/') || !s.glyphs.endsWith('.ts') || s.glyphs.includes('..')) {
      throw new ModuleContractError(
        `set ikon "${s.id}": glyphs harus berkas .ts di dalam web/ modul`,
      );
    }
  }
  return list;
}

/**
 * Runtime configuration contributed by a module (extension point 6, PRD E-3, E-8). A section is
 * generated into the admin settings form from this metadata; values live in the database per
 * tenant with a global fallback (E-2). Field keys are `<ns>.<name>` (G-9).
 */
export type ConfigFieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'secret'
  | 'markdown'
  | 'route'
  | 'theme'
  | 'locale'
  | 'list';

export interface ConfigFieldDef {
  /** `<section>.<name>`, e.g. `billing.tax_rate`. */
  readonly key: string;
  readonly type: ConfigFieldType;
  readonly title: LocalizedText;
  readonly note?: LocalizedText;
  /** Default when neither the tenant nor global has a value. Stored as its string form. */
  readonly default?: string | number | boolean | readonly string[] | null;
  /** For `select` / `list`: allowed values. */
  readonly options?: readonly { value: string; label: LocalizedText }[];
  /** Readable by anonymous clients (E-4). Never true for `secret`. */
  readonly public?: boolean;
  readonly order?: number;
  /** Numeric bounds / string length. */
  readonly min?: number;
  readonly max?: number;
}

export interface ConfigSectionDef {
  /** Section id: the module namespace (`billing`) or `<ns>.<sub>`. */
  readonly section: string;
  readonly title: LocalizedText;
  readonly note?: LocalizedText;
  readonly order?: number;
  readonly fields: readonly ConfigFieldDef[];
}

const CONFIG_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** Declare the configuration sections a module contributes (extension point 6). */
export function defineConfig(
  moduleName: string,
  list: readonly ConfigSectionDef[],
): readonly ConfigSectionDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const s of list) {
    if (s.section !== ns && !s.section.startsWith(`${ns}.`)) {
      throw new ModuleContractError(
        `section konfigurasi "${s.section}" harus "${ns}" atau diawali "${ns}."`,
      );
    }
    for (const f of s.fields) {
      if (!CONFIG_KEY_RE.test(f.key))
        throw new ModuleContractError(`kunci konfigurasi "${f.key}" tidak valid`);
      requirePrefix('kunci konfigurasi', f.key, `${ns}.`);
      if (seen.has(f.key)) throw new ModuleContractError(`kunci konfigurasi "${f.key}" duplikat`);
      seen.add(f.key);
      if (f.type === 'secret' && f.public) {
        throw new ModuleContractError(`kunci "${f.key}": field secret tidak boleh public (E-4)`);
      }
      if ((f.type === 'select' || f.type === 'list') && !f.options?.length) {
        throw new ModuleContractError(`kunci "${f.key}": tipe ${f.type} butuh options`);
      }
    }
  }
  return list;
}

/**
 * A public (no-auth) page tree contributed by a module (extension point 13, PRD R-2, F-7). Lives
 * OUTSIDE `/m/<ns>` — e.g. `/example`, `/product/[slug]` — so it can be a real front door.
 * `modules:sync` mirrors `dir` into the web app's public group and rejects a path that collides
 * with a core page or another module.
 */
export interface PublicRouteDef {
  /** URL path in SvelteKit notation, e.g. `/product/[slug]`. Must not start with `/m/`. */
  readonly path: string;
  /** Folder in the module holding `+page.svelte` (and siblings), relative to the module. */
  readonly dir: string;
  /** Include in sitemap.xml (F-7). Param routes need `sitemap: false` or a module-side lister. */
  readonly sitemap?: boolean;
}

const PUBLIC_PATH_RE =
  /^\/(?:[a-z0-9-]+|\[[a-z][a-zA-Z0-9]*\])(?:\/(?:[a-z0-9-]+|\[[a-z][a-zA-Z0-9]*\]))*$/;
const RESERVED_PUBLIC = [
  '/m',
  '/auth',
  '/dashboard',
  '/api',
  '/v1',
  '/theme',
  '/lang',
  '/settings',
  '/modules',
  '/users',
  '/groups',
  '/tenants',
  '/profile',
  '/examples',
];

/** Declare the public pages a module contributes (extension point 13). */
export function definePublicRoutes(
  moduleName: string,
  list: readonly PublicRouteDef[],
): readonly PublicRouteDef[] {
  namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const r of list) {
    if (!PUBLIC_PATH_RE.test(r.path)) {
      throw new ModuleContractError(
        `route publik "${r.path}" tidak valid — pakai bentuk /segmen/[param]`,
      );
    }
    if (RESERVED_PUBLIC.some((res) => r.path === res || r.path.startsWith(`${res}/`))) {
      throw new ModuleContractError(`route publik "${r.path}" memakai awalan yang dipakai core`);
    }
    if (seen.has(r.path)) throw new ModuleContractError(`route publik "${r.path}" duplikat`);
    seen.add(r.path);
    if (!r.dir.startsWith('web/') || r.dir.includes('..')) {
      throw new ModuleContractError(`route publik "${r.path}": dir harus di dalam web/ modul`);
    }
  }
  return list;
}

/**
 * Module seed (PRD O-3, R-3): idempotent demo/reference data for the default tenant, run by
 * `bun db:seed` after the core seed. Receives a raw `db` (the seed writes several tables) and the
 * default tenant id; MUST be safe to run on every deploy.
 */
export interface ModuleSeedContext {
  readonly db: unknown;
  readonly tenantId: string;
  readonly log: (msg: string) => void;
}
export type ModuleSeed = (ctx: ModuleSeedContext) => Promise<void>;

export function defineSeed(moduleName: string, run: ModuleSeed): ModuleSeed {
  namespaceOf(moduleName);
  if (typeof run !== 'function')
    throw new ModuleContractError(`modul ${moduleName}: defineSeed butuh fungsi`);
  return run;
}

/** Resource owners that belong to core; a module may reference these permissions in its menu. */
export const CORE_PERMISSION_OWNERS: ReadonlySet<string> = new Set([
  'user',
  'group',
  'client',
  'config',
  'module',
  'theme',
  'audit',
  'mail',
]);

/** Declare a module's tables. Names must carry the module prefix (`<ns>_`). */
export function defineTables(moduleName: string, list: readonly TableDef[]): readonly TableDef[] {
  const ns = namespaceOf(moduleName);
  for (const t of list) requirePrefix('nama tabel', t.name, `${ns}_`);
  return list;
}

/** Structural stand-in for an Elysia instance, so this package needs no elysia dependency. */
export interface ApiRoutesLike {
  readonly routes: readonly unknown[];
  readonly handle: (request: Request) => unknown;
}

/**
 * Declare a module's API (extension point 2). Pass the module's Elysia instance; `modules:sync`
 * mounts it under `/v1/m/<ns>` — the module never chooses (or escapes) its prefix (G-9).
 * Route paths inside are therefore relative: `.get('/notes', …)` becomes `/v1/m/<ns>/notes`.
 */
export function defineApiRoutes<T extends ApiRoutesLike>(moduleName: string, plugin: T): T {
  namespaceOf(moduleName); // validates shape; the prefix is applied by sync
  if (!plugin || !Array.isArray(plugin.routes) || typeof plugin.handle !== 'function') {
    throw new ModuleContractError(`modul ${moduleName}: defineApiRoutes butuh instance Elysia`);
  }
  return plugin;
}
