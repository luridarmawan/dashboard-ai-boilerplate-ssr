import { type Locale, type LocaleResolution, resolveLocale } from '@core/i18n';
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

export function rememberLocale(event: RequestEvent, locale: Locale): void {
  event.cookies.set(LANG_COOKIE, locale, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: event.url.protocol === 'https:' || process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}
