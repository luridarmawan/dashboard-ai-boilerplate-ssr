import {
  type Direction,
  directionOf,
  type Locale,
  type LocaleResolution,
  resolveLocale,
} from '@core/i18n';
import type { RequestEvent } from '@sveltejs/kit';
import { cfgString, type PublicConfig } from './config.ts';

/**
 * Language for ONE request (PRD K-2, K-3): user preference → `dab_lang` cookie →
 * Accept-Language → configured default (`app.default_locale`, per tenant with global fallback, K-3).
 * Decided before render, so the first HTML is already in the right language — never "always the
 * default first, then switch".
 */
export const LANG_COOKIE = 'dab_lang';

export function resolveRequestLocale(event: RequestEvent, config: PublicConfig): LocaleResolution {
  return resolveLocale({
    user: event.locals.session?.user.locale ?? null,
    cookie: event.cookies.get(LANG_COOKIE) ?? null,
    acceptLanguage: event.request.headers.get('accept-language'),
    defaultLocale: cfgString(config, 'app.default_locale') || null,
  });
}

/**
 * K-9: the direction follows the locale; the `dab_dir` cookie forces `rtl` so themes and layouts
 * can be checked without a right-to-left translation installed (the picker's "RTL preview").
 */
export const DIR_COOKIE = 'dab_dir';
export function resolveRequestDirection(event: RequestEvent, locale: Locale): Direction {
  return event.cookies.get(DIR_COOKIE) === 'rtl' ? 'rtl' : directionOf(locale);
}
export function rememberDirection(event: RequestEvent, dir: Direction | null): void {
  if (!dir) {
    event.cookies.delete(DIR_COOKIE, { path: '/' });
    return;
  }
  event.cookies.set(DIR_COOKIE, dir, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: event.url.protocol === 'https:' || process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function rememberLocale(event: RequestEvent, locale: Locale): void {
  event.cookies.set(LANG_COOKIE, locale, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: event.url.protocol === 'https:' || process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}
