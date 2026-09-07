import { ALL_TOKENS, type ShellKind, type ThemeTokens } from '@core/ui-theme';

/**
 * Theme editor plumbing (PRD L-24) shared by new + edit and by the editor component: the form ↔ API
 * shape. Browser-safe on purpose (the component imports it); seeding and previews, which read token
 * files on the server, live in `_editor.server.ts`.
 */

/** Dashboard variants the editor lets an admin map (Decision K: `default` is mandatory). */
export const VARIANTS: Readonly<Record<ShellKind, readonly string[]>> = {
  dashboard: ['default', 'wide', 'focused', 'split'],
  public: ['default'],
  auth: ['default'],
};
export const KINDS: readonly ShellKind[] = ['dashboard', 'public', 'auth'];

export interface EditorValues {
  slug: string;
  nameId: string;
  nameEn: string;
  descriptionId: string;
  descriptionEn: string;
  base: string;
  icons: string;
  layouts: Partial<Record<ShellKind, Record<string, string>>>;
  tokens: ThemeTokens;
  enabled: boolean;
}

export interface ThemeApiBody {
  slug: string;
  name: { id: string; en: string };
  description: { id: string; en: string } | null;
  base: string;
  icons: string;
  layouts: Record<string, Record<string, string>>;
  tokens: { light: Record<string, string>; dark: Record<string, string> };
  enabled: boolean;
}

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

/** Field names: `tl__<token>` light, `td__<token>` dark, `layout__<kind>__<variant>`. */
export function readEditorForm(form: FormData): EditorValues {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const name of ALL_TOKENS) {
    const l = str(form, `tl__${name}`);
    if (l) light[name] = l;
    const d = str(form, `td__${name}`);
    if (d) dark[name] = d;
  }
  const layouts: Partial<Record<ShellKind, Record<string, string>>> = {};
  for (const kind of KINDS) {
    const map: Record<string, string> = {};
    for (const variant of VARIANTS[kind]) {
      const id = str(form, `layout__${kind}__${variant}`);
      if (id) map[variant] = id;
    }
    layouts[kind] = map;
  }
  return {
    slug: str(form, 'slug').toLowerCase(),
    nameId: str(form, 'nameId'),
    nameEn: str(form, 'nameEn'),
    descriptionId: str(form, 'descriptionId'),
    descriptionEn: str(form, 'descriptionEn'),
    base: str(form, 'base'),
    icons: str(form, 'icons'),
    layouts,
    tokens: { light, dark },
    enabled: form.get('enabled') !== null,
  };
}

export function toApiBody(v: EditorValues): ThemeApiBody {
  return {
    slug: v.slug,
    name: { id: v.nameId, en: v.nameEn },
    description:
      v.descriptionId || v.descriptionEn ? { id: v.descriptionId, en: v.descriptionEn } : null,
    base: v.base,
    icons: v.icons,
    layouts: v.layouts as Record<string, Record<string, string>>,
    tokens: { light: { ...v.tokens.light }, dark: { ...v.tokens.dark } },
    enabled: v.enabled,
  };
}

/** Values from a stored theme (edit page). */
export function valuesOf(t: {
  code: string;
  name: { id: string; en: string };
  description: { id: string; en: string } | null;
  base: string;
  icons: string;
  layouts: Record<string, Record<string, string>>;
  tokens: ThemeTokens;
  enabled: boolean;
}): EditorValues {
  return {
    slug: t.code.replace(/^custom\./, ''),
    nameId: t.name.id,
    nameEn: t.name.en,
    descriptionId: t.description?.id ?? '',
    descriptionEn: t.description?.en ?? '',
    base: t.base,
    icons: t.icons,
    layouts: t.layouts as EditorValues['layouts'],
    tokens: t.tokens,
    enabled: t.enabled,
  };
}
