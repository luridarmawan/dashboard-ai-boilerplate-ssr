import type { LocalizedText, ShellKind, ThemeManifest } from './registry.ts';

/**
 * Themes assembled at runtime (PRD L-24) — the pure half: which tokens a theme has, how a
 * `tokens.css` is read and written, and the WCAG AA rules a theme must pass (L-21). No DOM, no fs,
 * no database: the API's theme store and the web app's picker both import this.
 *
 * The contrast pairs mirror `validate.mjs` (the build-time validator for file themes). Keep them in
 * step: a theme that would fail CI must fail the editor too.
 */

/** Colour tokens every theme defines, in both modes. Order = editor order. */
export const COLOR_TOKENS: readonly string[] = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'accent',
  'accent-foreground',
  'muted',
  'muted-foreground',
  'destructive',
  'destructive-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
];
/** Non-colour tokens (light mode only; dark inherits). */
export const SHAPE_TOKENS: readonly string[] = ['radius', 'font-sans', 'font-mono'];
export const ALL_TOKENS: readonly string[] = [...SHAPE_TOKENS, ...COLOR_TOKENS];

export type TokenMap = Readonly<Record<string, string>>;
export interface ThemeTokens {
  readonly light: TokenMap;
  /** Overrides on top of light; a token absent here inherits the light value. */
  readonly dark: TokenMap;
}

/** `[fg, bg, minimum ratio]` — 4.5 normal text (WCAG 1.4.3), 3.0 UI components (WCAG 1.4.11). */
export const CONTRAST_PAIRS: readonly (readonly [string, string, number])[] = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['foreground', 'muted', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['destructive', 'background', 4.5],
  ['success', 'background', 4.5],
  ['warning', 'background', 4.5],
  ['primary', 'background', 4.5],
  ['input', 'background', 3.0],
  ['ring', 'background', 3.0],
];

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v.trim());
}

function toRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG 2.1 contrast ratio between two hex colours (1…21). */
export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastProblem {
  readonly mode: 'light' | 'dark';
  readonly fg: string;
  readonly bg: string;
  readonly ratio: number | null;
  readonly minimum: number;
  /** Human message (Indonesian, like the CLI validator). */
  readonly message: string;
}

/** Every failing pair in both modes; empty = the theme passes L-21. Missing/non-hex tokens fail too. */
export function checkContrast(tokens: ThemeTokens): ContrastProblem[] {
  const problems: ContrastProblem[] = [];
  const modes: [ContrastProblem['mode'], TokenMap][] = [
    ['light', tokens.light],
    ['dark', { ...tokens.light, ...tokens.dark }],
  ];
  for (const [mode, map] of modes) {
    for (const [fg, bg, minimum] of CONTRAST_PAIRS) {
      const fgv = map[fg];
      const bgv = map[bg];
      if (!isHexColor(fgv) || !isHexColor(bgv)) {
        problems.push({
          mode,
          fg,
          bg,
          ratio: null,
          minimum,
          message: `${mode}: --${!isHexColor(fgv) ? fg : bg} kosong atau bukan warna hex`,
        });
        continue;
      }
      const ratio = contrastRatio(fgv, bgv);
      if (ratio < minimum)
        problems.push({
          mode,
          fg,
          bg,
          ratio,
          minimum,
          message: `${mode}: --${fg} pada --${bg} = ${ratio.toFixed(2)}, minimum ${minimum} (L-21)`,
        });
    }
  }
  return problems;
}

export interface ContrastRow {
  readonly mode: 'light' | 'dark';
  readonly fg: string;
  readonly bg: string;
  readonly ratio: number | null;
  readonly minimum: number;
  readonly ok: boolean;
}

/** Every pair in both modes with its ratio — what the editor shows, pass or fail (L-21). */
export function contrastReport(tokens: ThemeTokens): ContrastRow[] {
  const rows: ContrastRow[] = [];
  const modes: [ContrastRow['mode'], TokenMap][] = [
    ['light', tokens.light],
    ['dark', { ...tokens.light, ...tokens.dark }],
  ];
  for (const [mode, map] of modes) {
    for (const [fg, bg, minimum] of CONTRAST_PAIRS) {
      const fgv = map[fg];
      const bgv = map[bg];
      const ratio = isHexColor(fgv) && isHexColor(bgv) ? contrastRatio(fgv, bgv) : null;
      rows.push({ mode, fg, bg, ratio, minimum, ok: ratio !== null && ratio >= minimum });
    }
  }
  return rows;
}

/** Inline `--token: value;` declarations for a preview wrapper (values sanitised). */
export function tokensToInlineStyle(map: TokenMap): string {
  return Object.entries(map)
    .filter(([name]) => ALL_TOKENS.includes(name))
    .map(([name, value]) => `--${name}: ${sanitizeValue(value)}`)
    .join('; ');
}

/** Read a `tokens.css` (same rules as validate.mjs): first block = light, `data-mode="dark"` = dark. */
export function parseTokensCss(css: string): ThemeTokens {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const [, selector, body] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const target = /data-mode=['"]dark['"]/.test(selector ?? '') ? dark : light;
    for (const [, name, value] of (body ?? '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      if (name && value) target[name] = value.trim();
    }
  }
  return { light, dark };
}

/** Write the CSS the web app injects for a custom theme — the same selectors file themes use. */
export function tokensToCss(themeId: string, tokens: ThemeTokens): string {
  // Only characters a theme id may contain survive — the id is interpolated into a selector.
  const id = themeId.replace(/[^a-zA-Z0-9._-]/g, '');
  const line = (name: string, value: string) => `  --${name}: ${sanitizeValue(value)};`;
  const light = ALL_TOKENS.filter((n) => tokens.light[n] !== undefined).map((n) =>
    line(n, tokens.light[n] as string),
  );
  const dark = COLOR_TOKENS.filter((n) => tokens.dark[n] !== undefined).map((n) =>
    line(n, tokens.dark[n] as string),
  );
  return `[data-app-theme="${id}"] {\n${light.join('\n')}\n}\n[data-app-theme="${id}"][data-mode="dark"],\n[data-app-theme="${id}"] :is([data-mode="dark"]) {\n${dark.join('\n')}\n}\n`;
}

/** A token value may only be a colour, a length, or a font stack — never a CSS escape hatch. */
export function sanitizeValue(value: string): string {
  return value
    .replace(/[;{}<>]/g, '')
    .trim()
    .slice(0, 200);
}

/** Ids of admin-made themes carry this prefix so nothing can shadow a file theme. */
export const CUSTOM_PREFIX = 'custom.';
export const CUSTOM_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface CustomThemeDef {
  readonly code: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText | null;
  readonly icons: string;
  readonly layouts: Partial<Record<ShellKind, Record<string, string>>>;
  readonly tokens: ThemeTokens;
}

/** The registry-shaped manifest for a custom theme; `tokens` points nowhere because the CSS is inline. */
export function customManifest(def: CustomThemeDef): ThemeManifest {
  return {
    id: def.code,
    name: def.name,
    description: def.description ?? { id: '', en: '' },
    tokens: '',
    icons: def.icons,
    layouts: def.layouts,
    module: 'core',
    custom: true,
  };
}
