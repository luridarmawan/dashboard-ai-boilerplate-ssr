import {
  ALL_TOKENS,
  COLOR_TOKENS,
  parseTokensCss,
  type ThemeManifest,
  type ThemeTokens,
  themeById,
  tokensToCss,
} from '@core/ui-theme';
import { previewSvg, tokenSourceOf } from '$lib/server/theme-preview';
import type { EditorValues } from './_editor.ts';

/**
 * Server half of the theme editor (L-24): seed a new theme from a registered theme's tokens.css and
 * render previews — both need the token sources, which must never reach the browser bundle.
 */

/** Start a new theme as a copy of a registered file theme (or of a custom theme's stored tokens). */
export function seedFromBase(
  baseId: string,
  custom: readonly {
    code: string;
    tokens: ThemeTokens;
    icons: string;
    layouts: Record<string, Record<string, string>>;
  }[],
): EditorValues | null {
  const own = custom.find((c) => c.code === baseId);
  if (own) {
    return {
      slug: '',
      nameId: '',
      nameEn: '',
      descriptionId: '',
      descriptionEn: '',
      base: baseId,
      icons: own.icons,
      layouts: own.layouts as EditorValues['layouts'],
      tokens: own.tokens,
      enabled: true,
      logoId: '',
      logoUrl: null,
      faviconId: '',
      faviconUrl: null,
    };
  }
  const manifest = themeById(baseId);
  const css = tokenSourceOf(baseId);
  if (!manifest || !css) return null;
  const parsed = parseTokensCss(css);
  const light: Record<string, string> = {};
  for (const name of ALL_TOKENS) if (parsed.light[name]) light[name] = parsed.light[name] as string;
  const dark: Record<string, string> = {};
  for (const name of COLOR_TOKENS) if (parsed.dark[name]) dark[name] = parsed.dark[name] as string;
  return {
    slug: '',
    nameId: '',
    nameEn: '',
    descriptionId: '',
    descriptionEn: '',
    base: baseId,
    icons: manifest.icons,
    layouts: manifest.layouts as EditorValues['layouts'],
    tokens: { light, dark },
    enabled: true,
    logoId: '',
    logoUrl: null,
    faviconId: '',
    faviconUrl: null,
  };
}

/** Light + dark previews for whatever the form currently holds (valid or not). */
export function previewsFor(values: EditorValues): { light: string; dark: string } {
  const id = `custom.${values.slug || 'preview'}`;
  const manifest: ThemeManifest = {
    id,
    name: { id: values.nameId, en: values.nameEn },
    description: { id: '', en: '' },
    tokens: '',
    icons: values.icons,
    layouts: values.layouts,
    module: 'core',
    custom: true,
  };
  const css = tokensToCss(id, values.tokens);
  return { light: previewSvg(manifest, 'light', css), dark: previewSvg(manifest, 'dark', css) };
}
