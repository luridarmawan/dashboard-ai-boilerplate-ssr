import { and, type Db, eq, newId, schema } from '@core/db';
import {
  ALL_TOKENS,
  type ContrastProblem,
  CUSTOM_PREFIX,
  CUSTOM_SLUG_RE,
  type CustomThemeDef,
  checkContrast,
  customManifest,
  ICON_SETS,
  isHexColor,
  layoutById,
  REGIONS,
  type ShellKind,
  sanitizeValue,
  type ThemeManifest,
  type ThemeTokens,
  tokensToCss,
} from '@core/ui-theme';
import { type CacheAdapter, DatabaseVersionCache } from './cache.ts';
import { GLOBAL } from './store.ts';

/**
 * Admin-assembled themes (PRD L-24), stored in `themes`. Global rows apply to every tenant; a
 * tenant row applies to that tenant only. Read on every request through the versioned cache
 * (E-5), so a save on one instance is live everywhere on the next request — no deploy.
 *
 * A save is refused unless the theme passes the same checks a file theme passes in CI: icon set
 * and layouts registered and of the right kind (L-5, L-8), every token present, WCAG AA contrast
 * in both modes (L-21). The editor assembles; it never bypasses the contract.
 */

export type CustomThemeRow = typeof schema.themes.$inferSelect;

export interface CustomThemeInput {
  readonly slug: string;
  readonly name: { id: string; en: string };
  readonly description?: { id: string; en: string } | null;
  readonly base: string;
  readonly icons: string;
  readonly layouts: Partial<Record<ShellKind, Record<string, string>>>;
  readonly tokens: ThemeTokens;
  readonly enabled?: boolean;
  /** Public file ids (Q-16): `{ logo?, favicon? }`; resolved to URLs in the manifest. */
  readonly assets?: { logo?: string | null; favicon?: string | null } | null;
}

export interface CustomThemeView {
  readonly id: string;
  readonly scope: string;
  readonly code: string;
  readonly name: { id: string; en: string };
  readonly description: { id: string; en: string } | null;
  readonly base: string;
  readonly icons: string;
  readonly layouts: Partial<Record<ShellKind, Record<string, string>>>;
  readonly tokens: ThemeTokens;
  readonly enabled: boolean;
  readonly assets: { logo: string | null; favicon: string | null };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ThemeSaveResult =
  | { ok: true; row: CustomThemeRow }
  | {
      ok: false;
      code: 'invalid' | 'conflict' | 'not_found';
      errors: Record<string, string>;
      contrast: ContrastProblem[];
    };

type Rows = CustomThemeRow[];

export class CustomThemeStore {
  private readonly cache: CacheAdapter<Rows>;
  constructor(
    private readonly db: Db,
    cache?: CacheAdapter<Rows>,
  ) {
    this.cache = cache ?? new DatabaseVersionCache<Rows>(db, 'themes');
  }

  private async rows(): Promise<Rows> {
    const cached = await this.cache.get();
    // A Redis cache round-trips through JSON, which turns Date columns into strings (M7 #4).
    if (cached) return cached.map(reviveDates);
    const fresh = await this.db.select().from(schema.themes);
    await this.cache.set(fresh);
    return fresh;
  }

  /** Themes visible to a tenant: its own plus global ones (a tenant row shadows a global one by code). */
  async listFor(
    clientId: string | null,
    opts: { includeDisabled?: boolean } = {},
  ): Promise<CustomThemeRow[]> {
    const rows = await this.rows();
    const byCode = new Map<string, CustomThemeRow>();
    for (const r of rows.filter((x) => x.scope === GLOBAL)) byCode.set(r.code, r);
    if (clientId) for (const r of rows.filter((x) => x.scope === clientId)) byCode.set(r.code, r);
    return [...byCode.values()]
      .filter((r) => opts.includeDisabled || r.enabled)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Rows owned by ONE scope, for the editor list (tenant admins see their tenant's; superadmin the global ones). */
  async listOwned(scope: string | null): Promise<CustomThemeRow[]> {
    const rows = await this.rows();
    return rows
      .filter((r) => r.scope === (scope ?? GLOBAL))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async byId(id: string): Promise<CustomThemeRow | null> {
    return (await this.rows()).find((r) => r.id === id) ?? null;
  }

  /**
   * Registry-shaped manifests + injectable CSS for a tenant (what the web app needs per request).
   * `assets` become absolute API paths (`/v1/files/<id>/content`) the shell can put in an <img>.
   */
  async manifestsFor(clientId: string | null): Promise<{ manifest: ThemeManifest; css: string }[]> {
    return (await this.listFor(clientId)).map((r) => {
      const def = toDef(r);
      const a = assetsOf(r);
      const manifest: ThemeManifest = {
        ...customManifest(def),
        ...(a.logo || a.favicon
          ? {
              assets: {
                ...(a.logo ? { logo: `/v1/files/${a.logo}/content` } : {}),
                ...(a.favicon ? { favicon: `/v1/files/${a.favicon}/content` } : {}),
              },
            }
          : {}),
      };
      return { manifest, css: tokensToCss(def.code, def.tokens) };
    });
  }

  /** Validate an input against the contract. Returns errors keyed like form fields. */
  validate(input: CustomThemeInput): {
    errors: Record<string, string>;
    contrast: ContrastProblem[];
    tokens: ThemeTokens;
  } {
    const errors: Record<string, string> = {};
    if (!CUSTOM_SLUG_RE.test(input.slug) || input.slug.length > 40)
      errors.slug = 'huruf kecil, angka, tanda hubung; maks. 40 karakter';
    if (!input.name?.id?.trim() || !input.name?.en?.trim())
      errors.name = 'nama id dan en wajib diisi';
    if (!ICON_SETS[input.icons]) errors.icons = `set ikon "${input.icons}" tidak terdaftar (L-5)`;
    for (const kind of Object.keys(REGIONS) as ShellKind[]) {
      const map = input.layouts[kind];
      if (!map?.default) {
        errors[`layouts.${kind}`] = `varian "default" untuk ${kind} wajib ada`;
        continue;
      }
      for (const [variant, id] of Object.entries(map)) {
        const l = layoutById(id);
        if (!l) errors[`layouts.${kind}`] = `layout "${id}" tidak terdaftar (L-8)`;
        else if (l.kind !== kind)
          errors[`layouts.${kind}`] = `layout "${id}" bukan untuk ${kind} (${variant})`;
      }
    }
    for (const kind of Object.keys(input.layouts))
      if (!(kind in REGIONS)) errors[`layouts.${kind}`] = 'jenis shell tidak dikenal';
    // Tokens: sanitised copies; colours must be hex so contrast can be computed.
    const light: Record<string, string> = {};
    const dark: Record<string, string> = {};
    for (const name of ALL_TOKENS) {
      const lv = input.tokens.light?.[name];
      if (lv === undefined || lv === '') {
        errors[`tokens.light.${name}`] = 'wajib diisi';
        continue;
      }
      light[name] = sanitizeValue(String(lv));
      if (!name.startsWith('font') && name !== 'radius' && !isHexColor(light[name]))
        errors[`tokens.light.${name}`] = 'harus warna hex (#rrggbb)';
    }
    for (const [name, v] of Object.entries(input.tokens.dark ?? {})) {
      if (!ALL_TOKENS.includes(name) || v === undefined || v === '') continue;
      dark[name] = sanitizeValue(String(v));
      if (!name.startsWith('font') && name !== 'radius' && !isHexColor(dark[name]))
        errors[`tokens.dark.${name}`] = 'harus warna hex (#rrggbb)';
    }
    const tokens: ThemeTokens = { light, dark };
    const contrast = Object.keys(errors).length ? [] : checkContrast(tokens);
    return { errors, contrast, tokens };
  }

  async create(
    scope: string | null,
    input: CustomThemeInput,
    actorId: string | null,
  ): Promise<ThemeSaveResult> {
    const v = this.validate(input);
    if (Object.keys(v.errors).length || v.contrast.length)
      return { ok: false, code: 'invalid', errors: v.errors, contrast: v.contrast };
    const code = `${CUSTOM_PREFIX}${input.slug}`;
    const owner = scope ?? GLOBAL;
    const dup = (await this.rows()).find((r) => r.scope === owner && r.code === code);
    if (dup)
      return {
        ok: false,
        code: 'conflict',
        errors: { slug: `tema ${code} sudah ada` },
        contrast: [],
      };
    const id = newId();
    await this.db.insert(schema.themes).values({
      id,
      scope: owner,
      client_id: scope,
      code,
      name: input.name,
      description: input.description ?? null,
      base: input.base,
      tokens: v.tokens,
      icons: input.icons,
      layouts: input.layouts,
      assets: cleanAssets(input.assets),
      enabled: input.enabled ?? true,
      updated_by: actorId,
    });
    await this.cache.invalidate();
    const row = (await this.rows()).find((r) => r.id === id) as CustomThemeRow;
    return { ok: true, row };
  }

  async update(
    scope: string | null,
    id: string,
    input: CustomThemeInput,
    actorId: string | null,
  ): Promise<ThemeSaveResult> {
    const owner = scope ?? GLOBAL;
    const row = (await this.rows()).find((r) => r.id === id && r.scope === owner);
    if (!row) return { ok: false, code: 'not_found', errors: {}, contrast: [] };
    const v = this.validate(input);
    if (Object.keys(v.errors).length || v.contrast.length)
      return { ok: false, code: 'invalid', errors: v.errors, contrast: v.contrast };
    const code = `${CUSTOM_PREFIX}${input.slug}`;
    const dup = (await this.rows()).find(
      (r) => r.scope === owner && r.code === code && r.id !== id,
    );
    if (dup)
      return {
        ok: false,
        code: 'conflict',
        errors: { slug: `tema ${code} sudah ada` },
        contrast: [],
      };
    await this.db
      .update(schema.themes)
      .set({
        code,
        name: input.name,
        description: input.description ?? null,
        base: input.base,
        tokens: v.tokens,
        icons: input.icons,
        layouts: input.layouts,
        // `assets` omitted = keep; `{}` or nulls = clear.
        ...(input.assets === undefined ? {} : { assets: cleanAssets(input.assets) }),
        enabled: input.enabled ?? row.enabled,
        updated_by: actorId,
      })
      .where(eq(schema.themes.id, id));
    await this.cache.invalidate();
    const after = (await this.rows()).find((r) => r.id === id) as CustomThemeRow;
    return { ok: true, row: after };
  }

  async remove(scope: string | null, id: string): Promise<boolean> {
    const owner = scope ?? GLOBAL;
    const row = (await this.rows()).find((r) => r.id === id && r.scope === owner);
    if (!row) return false;
    await this.db
      .delete(schema.themes)
      .where(and(eq(schema.themes.id, id), eq(schema.themes.scope, owner)));
    await this.cache.invalidate();
    return true;
  }
}

function toDef(r: CustomThemeRow): CustomThemeDef {
  const tokens = (r.tokens ?? {}) as {
    light?: Record<string, string>;
    dark?: Record<string, string>;
  };
  return {
    code: r.code,
    name: r.name as { id: string; en: string },
    description: (r.description as { id: string; en: string } | null) ?? null,
    icons: r.icons,
    layouts: (r.layouts ?? {}) as Partial<Record<ShellKind, Record<string, string>>>,
    tokens: { light: tokens.light ?? {}, dark: tokens.dark ?? {} },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cleanAssets(a: CustomThemeInput['assets']): { logo?: string; favicon?: string } | null {
  if (!a) return null;
  const out: { logo?: string; favicon?: string } = {};
  if (a.logo && UUID_RE.test(a.logo)) out.logo = a.logo;
  if (a.favicon && UUID_RE.test(a.favicon)) out.favicon = a.favicon;
  return Object.keys(out).length ? out : null;
}
function assetsOf(r: CustomThemeRow): { logo: string | null; favicon: string | null } {
  const a = (r.assets ?? {}) as { logo?: unknown; favicon?: unknown };
  return {
    logo: typeof a.logo === 'string' ? a.logo : null,
    favicon: typeof a.favicon === 'string' ? a.favicon : null,
  };
}

/** Date columns come back as ISO strings from a JSON cache; make them Dates again. */
function reviveDates(r: CustomThemeRow): CustomThemeRow {
  const d = (v: unknown) =>
    v instanceof Date || v === null || v === undefined ? v : new Date(String(v));
  return {
    ...r,
    created_at: d(r.created_at) as Date,
    updated_at: d(r.updated_at) as Date,
    deleted_at: d(r.deleted_at) as Date | null,
  };
}

export function viewCustomTheme(r: CustomThemeRow): CustomThemeView {
  const def = toDef(r);
  return {
    id: r.id,
    scope: r.scope,
    code: r.code,
    name: def.name,
    description: def.description,
    base: r.base,
    icons: r.icons,
    layouts: def.layouts,
    tokens: def.tokens,
    enabled: r.enabled,
    assets: assetsOf(r),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
