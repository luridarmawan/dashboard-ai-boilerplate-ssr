import type { ThemeManifest } from '@core/ui-theme';
import baseCss from '@core/ui-theme/themes/base/tokens.css?raw';
import contrastCss from '@core/ui-theme/themes/contrast/tokens.css?raw';
import corporateCss from '@core/ui-theme/themes/corporate/tokens.css?raw';
import warmCss from '@core/ui-theme/themes/warm/tokens.css?raw';
import { moduleThemeTokens } from '$lib/../generated/theme-tokens';

/**
 * Theme previews for the picker (PRD L-3, L-13), generated from the theme's OWN tokens and
 * layout choice — so the preview cannot drift from the theme, and it works as an inline SVG
 * without JavaScript or image assets. Module themes (extension point 14) get their tokens
 * registered by `modules:sync`; until a `preview.png` exists this generator is the preview.
 */
const TOKEN_SOURCES: Record<string, string> = {
  base: baseCss,
  corporate: corporateCss,
  warm: warmCss,
  contrast: contrastCss,
  ...moduleThemeTokens,
};

export interface Palette {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  muted: string;
  border: string;
}

const NAMES: (keyof Palette)[] = ['background', 'foreground', 'card', 'primary', 'muted', 'border'];

/** Light and dark palettes from a tokens.css (same parsing rules as validate.mjs). */
export function paletteOf(themeId: string, mode: 'light' | 'dark'): Palette | null {
  const css = TOKEN_SOURCES[themeId]?.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!css) return null;
  const light: Partial<Palette> = {};
  const dark: Partial<Palette> = {};
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const target = /data-mode=['"]dark['"]/.test(selector ?? '') ? dark : light;
    for (const [, name, value] of (body ?? '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      if (NAMES.includes(name as keyof Palette))
        target[name as keyof Palette] = value?.trim() ?? '';
    }
  }
  const merged = mode === 'dark' ? { ...light, ...dark } : light;
  return NAMES.every((n) => merged[n]) ? (merged as Palette) : null;
}

/** A 160×100 skeleton of the dashboard in the theme's palette AND its default dashboard layout. */
export function previewSvg(theme: ThemeManifest, mode: 'light' | 'dark' = 'light'): string {
  const p = paletteOf(theme.id, mode);
  if (!p) return '';
  const layout = theme.layouts.dashboard?.default ?? 'sidebar-classic';
  const r = 3;
  const body =
    layout === 'topnav-compact'
      ? `<rect x="0" y="0" width="160" height="14" fill="${p.card}" stroke="${p.border}"/>
         <rect x="6" y="4" width="22" height="6" rx="2" fill="${p.primary}"/>
         <rect x="34" y="5" width="14" height="4" rx="1" fill="${p.foreground}" opacity=".6"/>
         <rect x="52" y="5" width="14" height="4" rx="1" fill="${p.foreground}" opacity=".35"/>
         <rect x="70" y="5" width="14" height="4" rx="1" fill="${p.foreground}" opacity=".35"/>
         <rect x="8" y="22" width="144" height="70" rx="${r}" fill="${p.card}" stroke="${p.border}"/>
         <rect x="16" y="30" width="60" height="5" rx="1" fill="${p.foreground}" opacity=".7"/>
         <rect x="16" y="42" width="128" height="4" rx="1" fill="${p.muted}"/>
         <rect x="16" y="50" width="128" height="4" rx="1" fill="${p.muted}"/>
         <rect x="16" y="58" width="128" height="4" rx="1" fill="${p.muted}"/>
         <rect x="16" y="76" width="30" height="8" rx="2" fill="${p.primary}"/>`
      : layout === 'centered-narrow'
        ? `<rect x="0" y="0" width="160" height="12" fill="${p.card}" stroke="${p.border}"/>
         <rect x="6" y="3" width="22" height="6" rx="2" fill="${p.primary}"/>
         <rect x="40" y="20" width="80" height="72" rx="${r}" fill="${p.card}" stroke="${p.border}"/>
         <rect x="48" y="28" width="40" height="5" rx="1" fill="${p.foreground}" opacity=".7"/>
         <rect x="48" y="40" width="64" height="6" rx="1" fill="${p.muted}"/>
         <rect x="48" y="50" width="64" height="6" rx="1" fill="${p.muted}"/>
         <rect x="48" y="60" width="64" height="6" rx="1" fill="${p.muted}"/>
         <rect x="48" y="76" width="28" height="8" rx="2" fill="${p.primary}"/>`
        : `<rect x="0" y="0" width="40" height="100" fill="${p.card}" stroke="${p.border}"/>
         <rect x="6" y="6" width="22" height="6" rx="2" fill="${p.primary}"/>
         <rect x="6" y="20" width="28" height="4" rx="1" fill="${p.foreground}" opacity=".6"/>
         <rect x="6" y="28" width="28" height="4" rx="1" fill="${p.foreground}" opacity=".35"/>
         <rect x="6" y="36" width="28" height="4" rx="1" fill="${p.foreground}" opacity=".35"/>
         <rect x="48" y="8" width="104" height="10" rx="2" fill="${p.card}" stroke="${p.border}"/>
         <rect x="48" y="24" width="104" height="68" rx="${r}" fill="${p.card}" stroke="${p.border}"/>
         <rect x="56" y="32" width="50" height="5" rx="1" fill="${p.foreground}" opacity=".7"/>
         <rect x="56" y="44" width="88" height="4" rx="1" fill="${p.muted}"/>
         <rect x="56" y="52" width="88" height="4" rx="1" fill="${p.muted}"/>
         <rect x="56" y="60" width="88" height="4" rx="1" fill="${p.muted}"/>
         <rect x="56" y="76" width="30" height="8" rx="2" fill="${p.primary}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" width="160" height="100" role="img" aria-label="Pratinjau tema ${theme.id}"><rect width="160" height="100" fill="${p.background}"/>${body}</svg>`;
}
