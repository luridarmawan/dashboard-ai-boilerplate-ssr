import { isMode, type Mode, resolveTheme, type ThemeResolution, themeById } from '@core/ui-theme';
import type { RequestEvent } from '@sveltejs/kit';
import { cfgList, cfgString, type PublicConfig } from './config.ts';

/**
 * Theme and mode for ONE request (PRD L-4, L-10…L-12), decided on the server before render:
 *   theme: user preference → `crk_theme` cookie → tenant default → global default → `base`
 *   mode : `crk_mode` cookie → `system`
 * Tenant/global defaults and the allowlist come from runtime configuration (`app.default_theme`,
 * `app.allowed_themes`, per tenant with global fallback — E-2), never from .env (E-6). A theme
 * contributed by a module that is disabled for the tenant is treated as absent (L-14).
 */
export const THEME_COOKIE = 'crk_theme';
export const MODE_COOKIE = 'crk_mode';

export interface ResolvedTheme extends ThemeResolution {
  readonly mode: Mode;
  readonly allowed: readonly string[] | null;
  /** Inline CSS for an admin-assembled theme (L-24); empty for file themes (their CSS is bundled). */
  readonly css: string;
}

export function resolveRequestTheme(event: RequestEvent, config: PublicConfig): ResolvedTheme {
  const configured = cfgList(config, 'app.allowed_themes');
  const extra = config.customThemes.map((c) => c.manifest);
  const lookup = (id: string | null | undefined) =>
    (id && extra.find((t) => t.id === id)) || themeById(id);
  // Module themes follow their module's state for this tenant (L-14): drop disabled ones.
  const usable = (id: string | null | undefined) => {
    const th = lookup(id);
    if (!th) return null;
    if (th.module && th.module !== 'core' && !config.enabledModules.has(th.module.toLowerCase()))
      return null;
    return id ?? null;
  };
  const allowed = configured.length ? configured.filter((id) => usable(id)) : null;
  const resolution = resolveTheme({
    user: usable(event.locals.session?.user.theme),
    cookie: usable(event.cookies.get(THEME_COOKIE)),
    tenantDefault: usable(cfgString(config, 'app.default_theme')), // tenant value or global fallback (E-2)
    globalDefault: null,
    allowed,
    extra,
  });
  const rawMode = event.cookies.get(MODE_COOKIE);
  const css = config.customThemes.find((c) => c.manifest.id === resolution.theme.id)?.css ?? '';
  return { ...resolution, mode: isMode(rawMode) ? rawMode : 'system', allowed, css };
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
