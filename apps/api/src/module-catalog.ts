import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Catalog, type CatalogView, catalogSchema, compareCatalog } from '@core/module-kit';
import { modules } from '@core/module-kit/registry';

/**
 * The module catalog the admin page and `GET /v1/module/catalog` show (PRD G-16). Source, in
 * order: `MODULES_CATALOG_URL` (a hosted JSON, fetched with a short timeout and cached ten
 * minutes) or `MODULES_CATALOG_FILE` (default `modules.catalog.json` in the working directory,
 * which the compose stack mounts / the repo ships). Neither reachable → the installed modules
 * alone, so the page still works and says why the catalog is missing.
 */
const CACHE_MS = 10 * 60 * 1000;
let cached: { url: string; at: number; catalog: Catalog } | null = null;

/**
 * The default catalogue file sits at the repo root (dev, where the api runs with cwd apps/api) or
 * the image's working directory (prod). Walk up a few levels from cwd; null when nowhere.
 */
function defaultCatalogFile(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'modules.catalog.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Wire shape: optional fields become explicit nulls (exactOptionalPropertyTypes + TypeBox). */
export interface CatalogEntryView extends Omit<CatalogView, 'description' | 'path' | 'homepage'> {
  readonly description: { id: string; en: string } | null;
  readonly path: string | null;
  readonly homepage: string | null;
}
export interface CatalogResult {
  readonly source: 'url' | 'file' | 'none';
  readonly url: string | null;
  readonly fetchedAt: string;
  readonly coreVersion: string | null;
  readonly error: string | null;
  readonly entries: CatalogEntryView[];
}

async function readCoreVersion(): Promise<string | null> {
  try {
    const pkg = JSON.parse(await Bun.file('package.json').text()) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

async function load(): Promise<{
  source: CatalogResult['source'];
  url: string | null;
  catalog: Catalog | null;
  error: string | null;
}> {
  const url = process.env.MODULES_CATALOG_URL?.trim();
  if (url) {
    if (cached && cached.url === url && Date.now() - cached.at < CACHE_MS)
      return { source: 'url', url, catalog: cached.catalog, error: null };
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = catalogSchema.safeParse(await res.json());
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? 'katalog tidak valid');
      cached = { url, at: Date.now(), catalog: parsed.data };
      return { source: 'url', url, catalog: parsed.data, error: null };
    } catch (err) {
      return {
        source: 'url',
        url,
        catalog: cached?.catalog ?? null,
        error: String(err).slice(0, 200),
      };
    }
  }
  const configured = process.env.MODULES_CATALOG_FILE?.trim();
  const file = configured || defaultCatalogFile();
  // No catalogue configured and none shipped: a plain "no source", not an error (the page says so).
  if (!file) return { source: 'none', url: null, catalog: null, error: null };
  try {
    const f = Bun.file(file);
    if (!(await f.exists()))
      return { source: 'none', url: null, catalog: null, error: `${file} tidak ada` };
    const parsed = catalogSchema.safeParse(JSON.parse(await f.text()));
    if (!parsed.success)
      return {
        source: 'file',
        url: null,
        catalog: null,
        error: parsed.error.issues[0]?.message ?? 'katalog tidak valid',
      };
    return { source: 'file', url: null, catalog: parsed.data, error: null };
  } catch (err) {
    return { source: 'file', url: null, catalog: null, error: String(err).slice(0, 200) };
  }
}

export async function moduleCatalog(): Promise<CatalogResult> {
  const [{ source, url, catalog, error }, coreVersion] = await Promise.all([
    load(),
    readCoreVersion(),
  ]);
  const installed = modules.map((m) => ({ name: m.name, version: m.version }));
  const entries: CatalogEntryView[] = compareCatalog(
    catalog ?? { modules: [] },
    installed,
    coreVersion,
  ).map((e) => ({
    ...e,
    description: e.description ?? null,
    path: e.path ?? null,
    homepage: e.homepage ?? null,
  }));
  // Installed modules the catalog does not know still show up, as installed.
  for (const m of modules)
    if (!entries.some((e) => e.name === m.name))
      entries.push({
        name: m.name,
        version: m.version,
        description: m.description ?? null,
        repo: m.source === 'local' ? '(lokal)' : m.source,
        ref: '-',
        path: m.path ?? null,
        bundled: m.source === 'local',
        homepage: null,
        engines: { core: '*' },
        tags: [],
        status: 'installed',
        installedVersion: m.version,
        installCommand: null,
      });
  return { source, url, fetchedAt: new Date().toISOString(), coreVersion, error, entries };
}
