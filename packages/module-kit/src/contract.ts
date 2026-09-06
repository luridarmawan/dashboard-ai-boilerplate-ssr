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

/** Resource owners that belong to core; a module may reference these permissions in its menu. */
export const CORE_PERMISSION_OWNERS: ReadonlySet<string> = new Set([
  'user',
  'group',
  'client',
  'config',
  'module',
  'theme',
  'audit',
]);

/** Declare a module's tables. Names must carry the module prefix (`<ns>_`). */
export function defineTables(moduleName: string, list: readonly TableDef[]): readonly TableDef[] {
  const ns = namespaceOf(moduleName);
  for (const t of list) requirePrefix('nama tabel', t.name, `${ns}_`);
  return list;
}
