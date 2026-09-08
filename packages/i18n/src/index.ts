import { LOCALES, type Locale, type MessageKey, messages } from './generated/messages.ts';

/**
 * i18n runtime (PRD K-1…K-5). Messages are plain JSON per locale: core in
 * `packages/i18n/messages/<locale>.json`, modules in `modules/<Name>/i18n/<locale>.json`
 * (keys namespaced `<ns>.*`, K-6). `modules:sync` merges them into the generated `messages.ts`,
 * so `MessageKey` is a union of every key that exists — a typo fails `bun check` (K-5).
 */
export { LOCALES, type Locale, type MessageKey, messages };

export const DEFAULT_LOCALE: Locale = 'id';

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/**
 * Writing direction (K-9). Decided from the locale on the server and written on `<html dir>`
 * before the first byte, like the language itself. Layouts and components use CSS logical
 * properties (Tailwind `ms-/me-/ps-/pe-/start-/end-/text-start/text-end`), so one stylesheet
 * serves both directions; only the few icons that point "forward" flip (`rtl:rotate-180`).
 */
export type Direction = 'ltr' | 'rtl';
/** Language subtags written right-to-left; a locale tag like `ar-EG` matches by its language. */
export const RTL_LANGUAGES: readonly string[] = [
  'ar',
  'he',
  'fa',
  'ur',
  'ps',
  'sd',
  'ug',
  'yi',
  'dv',
];
export function directionOf(locale: string | null | undefined): Direction {
  const lang = (locale ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr';
}

export type Params = Record<string, string | number>;

/** `{name}` placeholders; unknown placeholders are left visible rather than swallowed. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export type Translate = (key: MessageKey, params?: Params) => string;

/**
 * A translator bound to one locale. Missing key: falls back to the default locale, then to the
 * key itself — never an empty string (K-4); dev logs a warning once per key.
 */
export function createTranslator(locale: Locale, onMissing?: (key: string) => void): Translate {
  const primary = messages[locale] as Record<string, string>;
  const fallback = messages[DEFAULT_LOCALE] as Record<string, string>;
  const warned = new Set<string>();
  return (key, params) => {
    const text = primary[key] ?? fallback[key];
    if (text === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        onMissing?.(key);
      }
      return key;
    }
    return interpolate(text, params);
  };
}

export interface LocaleResolutionInput {
  /** The user's saved preference (D-4). */
  readonly user?: string | null;
  /** `dab_lang` cookie — anonymous visitors, and persistence for the picker (K-7). */
  readonly cookie?: string | null;
  /** Raw `Accept-Language` header. */
  readonly acceptLanguage?: string | null;
  /** Tenant / global default from configuration (K-3); M3 wires the tenant part. */
  readonly defaultLocale?: string | null;
}

export interface LocaleResolution {
  readonly locale: Locale;
  readonly source: 'user' | 'cookie' | 'header' | 'default';
}

/** K-2: user → cookie → Accept-Language → configured default → built-in default. Server-side. */
export function resolveLocale(input: LocaleResolutionInput): LocaleResolution {
  if (isLocale(input.user)) return { locale: input.user, source: 'user' };
  if (isLocale(input.cookie)) return { locale: input.cookie, source: 'cookie' };
  for (const lang of parseAcceptLanguage(input.acceptLanguage)) {
    const short = lang.split('-')[0] ?? lang;
    if (isLocale(lang)) return { locale: lang, source: 'header' };
    if (isLocale(short)) return { locale: short, source: 'header' };
  }
  if (isLocale(input.defaultLocale)) return { locale: input.defaultLocale, source: 'default' };
  return { locale: DEFAULT_LOCALE, source: 'default' };
}

/** Languages from an Accept-Language header, best quality first. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: (tag ?? '').toLowerCase(), q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}

/**
 * Namespaces a visitor can need BEFORE signing in: the shell chrome, the landing, the auth pages,
 * the theme and language pickers, the shared table/form components, and the error pages. Everything
 * else belongs to the dashboard, and the public landing page has the tightest budget of the app
 * (PRD §9), so an anonymous response does not carry it. Module namespaces are added by the caller
 * for the modules that contribute public routes. `apps/web` has a test that fails when a page an
 * anonymous visitor can reach uses a key outside this set.
 */
export const ANONYMOUS_NAMESPACES: readonly string[] = [
  'app',
  'auth',
  'common',
  'error',
  'landing',
  'lang',
  'nav',
  'shell',
  'table',
  'theme',
];

/**
 * Only the ACTIVE locale's messages travel to the browser — never the whole catalogue. With
 * `namespaces`, only those namespaces travel (K-4 renders a missing key as the key itself, so a
 * filter that is too tight is visible, never fatal).
 */
export function messagesFor(
  locale: Locale,
  namespaces?: readonly string[],
): Readonly<Record<string, string>> {
  const all = messages[locale] as Record<string, string>;
  if (!namespaces) return all;
  const allow = new Set(namespaces);
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(all)) {
    const dot = key.indexOf('.');
    if (allow.has(dot < 0 ? key : key.slice(0, dot))) out[key] = text;
  }
  return out;
}
