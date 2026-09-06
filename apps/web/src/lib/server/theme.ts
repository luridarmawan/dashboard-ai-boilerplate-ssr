import { isMode, type Mode, resolveTheme, type ThemeResolution } from '@core/ui-theme';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/**
 * Theme and mode for ONE request (PRD L-4, L-10…L-12), decided on the server before render:
 *   theme: user preference → `dab_theme` cookie → tenant default → global default → `base`
 *   mode : `dab_mode` cookie → `system`
 * Tenant/global defaults and the allowlist come from runtime configuration in M3; until then the
 * global default and allowlist are read from env (`THEME_DEFAULT`, `THEMES_ALLOWED`) so the
 * chain is complete and testable today.
 */
export const THEME_COOKIE = 'dab_theme';
export const MODE_COOKIE = 'dab_mode';

export interface ResolvedTheme extends ThemeResolution {
  readonly mode: Mode;
  readonly allowed: readonly string[] | null;
}

function allowedThemes(): readonly string[] | null {
  const raw = env.THEMES_ALLOWED?.trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveRequestTheme(event: RequestEvent): ResolvedTheme {
  const allowed = allowedThemes();
  const resolution = resolveTheme({
    user: event.locals.session?.user.theme ?? null,
    cookie: event.cookies.get(THEME_COOKIE) ?? null,
    tenantDefault: null, // app.default_theme per tenant — configuration lands in M3
    globalDefault: env.THEME_DEFAULT ?? null,
    allowed,
  });
  const rawMode = event.cookies.get(MODE_COOKIE);
  return { ...resolution, mode: isMode(rawMode) ? rawMode : 'system', allowed };
}

const secure = (event: RequestEvent) =>
  event.url.protocol === 'https:' || process.env.NODE_ENV === 'production';

/** Persist a choice for anonymous visitors and across sessions (L-11, L-13). One year. */
export function rememberTheme(event: RequestEvent, theme: string | null, mode: Mode | null): void {
  const opts = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secure(event),
    maxAge: 60 * 60 * 24 * 365,
  };
  if (theme) event.cookies.set(THEME_COOKIE, theme, opts);
  if (mode) event.cookies.set(MODE_COOKIE, mode, opts);
}
