import { z } from 'zod';

/**
 * Schemas for the two manifest files of the module system (PRD §4.5, §4.9).
 *
 *   modules.json        — the list of module SOURCES, owned by the host repo
 *   <module>/module.json — the module's own identity, owned by the module
 *
 * Both are validated with real schemas so a typo fails at `modules:sync` with a message
 * that names the file and the field — never as a confusing import error later.
 */

/** Folder-cased module name: `Example`, `AI`, `Billing`. The namespace is its lowercase form. */
export const MODULE_NAME_RE = /^[A-Z][A-Za-z0-9]{1,39}$/;

export const localizedText = z.object({ id: z.string().min(1), en: z.string().min(1) });
export type LocalizedText = z.infer<typeof localizedText>;

export const moduleManifestSchema = z.object({
  name: z
    .string()
    .regex(MODULE_NAME_RE, 'nama modul: huruf besar di depan, alfanumerik, 2–40 karakter'),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'versi harus semver x.y.z'),
  description: localizedText.optional(),
  engines: z.object({
    /** Semver range of core this module supports (G-11). Checked at sync, not at import. */
    core: z.string().min(1),
  }),
  /** Other modules this one needs, by name; sync orders initialisation accordingly (G-11). */
  dependencies: z.array(z.string().regex(MODULE_NAME_RE)).default([]),
  /**
   * The module's own sidebar group (F-3): its title (default: the module name) and sort key among
   * groups (default 100; core `settings`/`integration` come before, `monitoring` after).
   */
  menu: z
    .object({ label: localizedText, order: z.number().int().min(0).max(999).optional() })
    .optional(),
});
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

const sourceBase = { name: z.string().regex(MODULE_NAME_RE) };

export const moduleSourceSchema = z.discriminatedUnion('source', [
  z.object({ ...sourceBase, source: z.literal('local'), path: z.string().min(1) }),
  z.object({
    ...sourceBase,
    source: z.literal('submodule'),
    repo: z.string().min(1),
    /** Always a tag or commit — never a moving branch (Decision L). */
    ref: z.string().min(1),
    path: z.string().min(1).optional(),
  }),
  z.object({
    ...sourceBase,
    source: z.literal('package'),
    package: z.string().min(1),
    version: z.string().min(1),
  }),
]);
export type ModuleSource = z.infer<typeof moduleSourceSchema>;

export const modulesFileSchema = z.object({
  $comment: z.string().optional(),
  modules: z.array(moduleSourceSchema),
});
export type ModulesFile = z.infer<typeof modulesFileSchema>;

/** Namespace of a module: `Example` → `example`. Prefixes tables, permissions, menu ids, routes, i18n keys, theme ids (G-9). */
export function namespaceOf(name: string): string {
  return name.toLowerCase();
}

/**
 * Minimal semver range check for `engines.core` (G-11). Supports `*`, exact, `>=`, `^`, `~`
 * and space-joined conjunctions such as `>=1.2.0 <2.0.0`. Deliberately small: modules pin
 * against core in one of these shapes, and a full semver library would be a dependency
 * shipped to every module for four operators.
 */
export function satisfiesCore(version: string, range: string): boolean {
  const v = parse(version);
  if (!v) return false;
  const clauses = range.trim().split(/\s+/).filter(Boolean);
  if (clauses.length === 0 || clauses[0] === '*') return true;
  return clauses.every((c) => satisfiesClause(v, c));
}

type V = [number, number, number];

function parse(s: string): V | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmp(a: V, b: V): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function satisfiesClause(v: V, clause: string): boolean {
  const m = /^(>=|<=|>|<|\^|~|=)?\s*v?(\d+(?:\.\d+){0,2})$/.exec(clause);
  if (!m) return false;
  const op = m[1] ?? '=';
  const parts = (m[2] ?? '0').split('.').map(Number);
  const b: V = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  switch (op) {
    case '>=':
      return cmp(v, b) >= 0;
    case '<=':
      return cmp(v, b) <= 0;
    case '>':
      return cmp(v, b) > 0;
    case '<':
      return cmp(v, b) < 0;
    case '=':
      return cmp(v, b) === 0;
    case '^': {
      // Same major (or same minor when major is 0), at least the given version.
      const upper: V = b[0] > 0 ? [b[0] + 1, 0, 0] : b[1] > 0 ? [0, b[1] + 1, 0] : [0, 0, b[2] + 1];
      return cmp(v, b) >= 0 && cmp(v, upper) < 0;
    }
    case '~': {
      const upper: V = [b[0], b[1] + 1, 0];
      return cmp(v, b) >= 0 && cmp(v, upper) < 0;
    }
    default:
      return false;
  }
}
