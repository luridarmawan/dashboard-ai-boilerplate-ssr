import { resolveLayout } from '@core/ui-theme';
import { env } from '$env/dynamic/private';
import { layoutVariants } from '$lib/../generated/layout-variants';
import type { LayoutServerLoad } from './$types';

/**
 * `LOGIN_PAGE_BACKGROUND` in `.env` — the picture behind the brand panel of an auth layout that
 * has one (`split-hero`). Deploy-time branding like APP_LANDING_TITLE: it must be right in the
 * first HTML, before any database is read (F-6), so it lives in the environment rather than in
 * `configurations`.
 *
 * Only an absolute http(s) URL or a root-relative path is usable; anything else (a bare hostname,
 * a stray `./logo.png`, a blank value) is dropped and the panel keeps its plain brand colour.
 * Same rule the root layout applies to theme assets.
 *
 * The value ends up inside a CSS `url("…")`, so the characters that could end that function early
 * are refused outright rather than escaped: quotes, parentheses, a semicolon, a backslash or any
 * whitespace. An operator who can edit `.env` can already do anything, but a URL that silently
 * produced a broken stylesheet would be a miserable thing to debug.
 */
const CSS_UNSAFE = /["'()\\;\s]/;
function loginBackground(): string | null {
  const v = env.LOGIN_PAGE_BACKGROUND?.trim();
  if (!v || CSS_UNSAFE.test(v)) return null;
  return v.startsWith('/') || /^https?:\/\//.test(v) ? v : null;
}

/** Auth pages use the theme's `auth` layout (centered card, split hero, …). */
export const load: LayoutServerLoad = async (event) => {
  const variant = layoutVariants[event.route.id ?? ''] ?? 'default';
  const layout = resolveLayout(event.locals.theme.theme, 'auth', variant);
  return { layoutId: layout.layout.id, layoutVariant: variant, background: loginBackground() };
};
