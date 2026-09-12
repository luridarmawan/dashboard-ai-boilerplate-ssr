import iconsJson from '../icons/registry.json';
import layoutsJson from '../layouts/registry.json';
import baseTheme from '../themes/base/theme.json';
import contrastTheme from '../themes/contrast/theme.json';
import corporateTheme from '../themes/corporate/theme.json';
import warmTheme from '../themes/warm/theme.json';
import { moduleIconSets, moduleLayouts, moduleThemes } from './generated/contrib.ts';

/**
 * The theme registry (PRD §4.8, L-3…L-9). Everything here is static data shared by the web
 * app (SSR resolution) and tooling (validator, sync). No DOM, no fs — safe in the browser.
 *
 * Built-in themes are imported explicitly so the bundler sees exactly which manifests ship
 * (L-15). Themes contributed by modules (extension point 14) are appended by `modules:sync`
 * through `registerTheme()` in the generated registry.
 */

export type ShellKind = 'dashboard' | 'public' | 'auth';
export type Mode = 'light' | 'dark' | 'system';
export type CoreVariant = 'default' | 'wide' | 'focused' | 'split';
/** Open registry: modules may add `<ns>.<variant>` (Decision K). */
export type LayoutVariant = CoreVariant | (string & {});

export interface LocalizedText {
  readonly id: string;
  readonly en: string;
}

export interface ThemeManifest {
  readonly id: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly tokens: string;
  readonly icons: string;
  readonly layouts: Partial<Record<ShellKind, Record<string, string>>>;
  readonly assets?: { readonly logo?: string; readonly favicon?: string };
  readonly preview?: string;
  /** Owning module for contributed themes; `core` for the built-ins. */
  readonly module?: string;
  /** Assembled in the admin UI and stored in the database (L-24); its CSS is injected per request. */
  readonly custom?: boolean;
}

export interface LayoutDef {
  readonly id: string;
  readonly kind: ShellKind;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly module?: string;
}

export interface IconSetDef {
  readonly name: LocalizedText;
  readonly style: 'stroke' | 'fill';
  readonly strokeWidth?: number;
  readonly grid: number;
  readonly source: string;
  readonly license: string;
  readonly note?: string;
}

export const REGIONS: Readonly<Record<ShellKind, readonly string[]>> = layoutsJson.regions;
export const CORE_VARIANTS: readonly CoreVariant[] = ['default', 'wide', 'focused', 'split'];
export const CORE_ICONS: readonly string[] = iconsJson.core;
export const ICON_SETS: Readonly<Record<string, IconSetDef>> = {
  ...(iconsJson.sets as Record<string, IconSetDef>),
  // Icon sets contributed by modules (extension point 16), appended by modules:sync.
  ...Object.fromEntries(
    (moduleIconSets as readonly (IconSetDef & { id: string })[]).map(({ id, ...meta }) => [
      id,
      meta,
    ]),
  ),
};

const themeList: ThemeManifest[] = [
  ...[baseTheme, corporateTheme, warmTheme, contrastTheme].map((t) => ({
    ...(t as ThemeManifest),
    module: 'core',
  })),
  // Themes contributed by modules (extension point 14), validated and appended by modules:sync.
  ...(moduleThemes as readonly ThemeManifest[]),
];
const layoutList: LayoutDef[] = [
  ...layoutsJson.layouts.map((l) => ({ ...(l as LayoutDef), module: 'core' })),
  // Layouts contributed by modules (extension point 15).
  ...(moduleLayouts as readonly LayoutDef[]),
];

/** Built-in default when nothing else decides (L-12 step 5). */
export const FALLBACK_THEME = 'base';

export function themes(): readonly ThemeManifest[] {
  return themeList;
}
export function themeById(id: string | null | undefined): ThemeManifest | null {
  return themeList.find((t) => t.id === id) ?? null;
}
export function layouts(): readonly LayoutDef[] {
  return layoutList;
}
export function layoutById(id: string): LayoutDef | null {
  return layoutList.find((l) => l.id === id) ?? null;
}

/** Extension points 14 and 15: contributed by modules through `modules:sync`, never by hand. */
export function registerTheme(theme: ThemeManifest): void {
  if (themeList.some((t) => t.id === theme.id)) return;
  themeList.push(theme);
}
export function registerLayout(layout: LayoutDef): void {
  if (layoutList.some((l) => l.id === layout.id)) return;
  layoutList.push(layout);
}

export interface ThemeResolutionInput {
  /** The user's saved preference (D-4), if logged in. */
  readonly user?: string | null;
  /** `crk_theme` cookie — anonymous visitors and cross-session persistence (L-11). */
  readonly cookie?: string | null;
  /** `app.default_theme` for the active tenant (L-10); configuration UI lands in M3. */
  readonly tenantDefault?: string | null;
  /** `app.default_theme` global fallback. */
  readonly globalDefault?: string | null;
  /** `app.allowed_themes` — a theme outside this list is treated as absent (L-11). */
  readonly allowed?: readonly string[] | null;
  /** Runtime themes (L-24) that count as registered for this resolution. */
  readonly extra?: readonly ThemeManifest[] | null;
}

export interface ThemeResolution {
  readonly theme: ThemeManifest;
  /** Which step of the chain decided: useful in dev, harmless in prod. */
  readonly source: 'user' | 'cookie' | 'tenant' | 'global' | 'fallback';
}

/**
 * L-12: user → cookie → tenant default → global default → built-in. A candidate that is not
 * registered (theme removed, module disabled — L-14) or not allowed (L-11) is skipped without
 * error; the next step decides. Runs on the server before the first byte is sent.
 */
export function resolveTheme(input: ThemeResolutionInput): ThemeResolution {
  const allowed = input.allowed?.length ? new Set(input.allowed) : null;
  const lookup = (id: string): ThemeManifest | null =>
    input.extra?.find((t) => t.id === id) ?? themeById(id);
  const ok = (id: string | null | undefined): ThemeManifest | null => {
    if (!id) return null;
    if (allowed && !allowed.has(id)) return null;
    return lookup(id);
  };
  const steps: readonly [ThemeResolution['source'], string | null | undefined][] = [
    ['user', input.user],
    ['cookie', input.cookie],
    ['tenant', input.tenantDefault],
    ['global', input.globalDefault],
  ];
  for (const [source, id] of steps) {
    const theme = ok(id);
    if (theme) return { theme, source };
  }
  // The allowlist may itself exclude the built-in fallback: then its first entry is the floor.
  const floor = (allowed && lookup([...allowed][0] ?? '')) || themeById(FALLBACK_THEME);
  if (!floor) throw new Error('ui-theme: tidak ada tema terdaftar sama sekali');
  return { theme: floor, source: 'fallback' };
}

export interface LayoutResolution {
  readonly layout: LayoutDef;
  readonly variant: string;
  /** True when the requested variant was not mapped and `default` was used (dev warning, L-9). */
  readonly fellBack: boolean;
}

/**
 * Decision K: page variant → the theme's mapping for that shell kind → the theme's `default`
 * → the first registered layout of that kind. Never throws for an unknown variant.
 */
export function resolveLayout(
  theme: ThemeManifest,
  kind: ShellKind,
  variant: LayoutVariant = 'default',
): LayoutResolution {
  const map = theme.layouts[kind] ?? {};
  const pick = (id: string | undefined) => (id ? layoutById(id) : null);
  const exact = pick(map[variant]);
  if (exact && exact.kind === kind) return { layout: exact, variant, fellBack: false };
  const def = pick(map.default);
  if (def && def.kind === kind) return { layout: def, variant, fellBack: variant !== 'default' };
  const any = layoutList.find((l) => l.kind === kind);
  if (!any) throw new Error(`ui-theme: tidak ada layout untuk jenis shell "${kind}"`);
  return { layout: any, variant, fellBack: true };
}

export function isMode(v: unknown): v is Mode {
  return v === 'light' || v === 'dark' || v === 'system';
}
