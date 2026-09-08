import { z } from 'zod';
import { localizedText, MODULE_NAME_RE, satisfiesCore } from './manifest.ts';

/**
 * Module catalog (PRD G-16): a plain JSON list of modules that can be installed with
 * `bun modules:add` — browsed from the CLI (`bun modules:search`) and the module admin page, and
 * installed with `bun modules:install <Name>`, which resolves the pinned `repo` + `ref` from here.
 * Installing is a build-time act by design (a module is code: submodule, migration, image), so
 * the UI shows the exact command instead of pretending to hot-install anything.
 */
export const catalogEntrySchema = z.object({
  name: z.string().regex(MODULE_NAME_RE, 'nama modul: huruf besar di depan, alfanumerik'),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'versi harus semver x.y.z'),
  description: localizedText.optional(),
  /** Git URL `modules:add` clones from. Bundled modules point at the core repository itself. */
  repo: z.string().min(1),
  /** Tag or commit — never a branch (Decision L). */
  ref: z.string().min(1),
  /** Path inside `repo` for bundled modules (informational). */
  path: z.string().min(1).optional(),
  /** Ships with core; nothing to install. */
  bundled: z.boolean().default(false),
  homepage: z.string().url().optional(),
  engines: z.object({ core: z.string().min(1) }),
  tags: z.array(z.string().min(1)).default([]),
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const catalogSchema = z.object({
  $comment: z.string().optional(),
  updatedAt: z.string().optional(),
  modules: z.array(catalogEntrySchema),
});
export type Catalog = z.infer<typeof catalogSchema>;

export type CatalogStatus = 'installed' | 'update' | 'available' | 'incompatible';

export interface CatalogView extends CatalogEntry {
  readonly status: CatalogStatus;
  readonly installedVersion: string | null;
  /** What to run on the host; null for bundled modules and for anything already current. */
  readonly installCommand: string | null;
}

/** Numeric semver order; a prerelease sorts below its release. Unknown shapes compare equal. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('-');
  const pb = b.split('-');
  const na = (pa[0] ?? '').split('.').map(Number);
  const nb = (pb[0] ?? '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (pa.length !== pb.length) return pa.length > pb.length ? -1 : 1;
  return 0;
}

/**
 * Judge every catalog entry against what is installed and the running core version:
 * installed (same or newer here), update (catalog is newer), available (not installed, compatible),
 * incompatible (its `engines.core` does not match this core). Unknown core → never incompatible.
 */
export function compareCatalog(
  catalog: Catalog,
  installed: readonly { name: string; version: string }[],
  coreVersion: string | null,
): CatalogView[] {
  return catalog.modules.map((e) => {
    const have = installed.find((m) => m.name === e.name);
    const compatible = coreVersion === null || satisfiesCore(coreVersion, e.engines.core);
    let status: CatalogStatus;
    if (have) status = compareSemver(e.version, have.version) > 0 ? 'update' : 'installed';
    else status = compatible ? 'available' : 'incompatible';
    if (have && status === 'update' && !compatible) status = 'incompatible';
    const installCommand =
      e.bundled || status === 'installed' || status === 'incompatible'
        ? null
        : `bun modules:add ${e.repo} --ref ${e.ref}`;
    return { ...e, status, installedVersion: have?.version ?? null, installCommand };
  });
}

/** Case-insensitive search over name, description and tags (the CLI's `modules:search`). */
export function searchCatalog<T extends CatalogEntry>(entries: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((e) =>
    [e.name, e.description?.id ?? '', e.description?.en ?? '', ...e.tags]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}
