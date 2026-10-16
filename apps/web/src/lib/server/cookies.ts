/**
 * Every cookie the web app writes, in one place. The modules that own each cookie re-export its
 * name from here, so callers keep importing from them; this registry exists so the logout sweep
 * (`forget.ts`, A-5) cannot miss one, and so tests can read the names without pulling in the
 * SvelteKit `$env` modules that `session.ts` and `config.ts` need.
 */
export const SESSION_COOKIE = 'crk_session';
/** Impersonation (D-6): rides along with the admin's own session cookie. */
export const IMPERSONATE_COOKIE = 'crk_impersonate';
export const CSRF_COOKIE = 'crk_csrf';
/** Sign in with Google (A-8): state + PKCE verifier, scoped to the flow's path. */
export const OAUTH_COOKIE = 'crk_oauth';
export const OAUTH_COOKIE_PATH = '/auth/google';
export const THEME_COOKIE = 'crk_theme';
export const MODE_COOKIE = 'crk_mode';
export const LANG_COOKIE = 'crk_lang';
export const DIR_COOKIE = 'crk_dir';
export const SIDEBAR_COOKIE = 'crk_sidebar';

/** All of the above with the path each one was set under — a cookie is only deleted at its own path. */
export const APP_COOKIES: readonly { readonly name: string; readonly path: string }[] = [
  { name: SESSION_COOKIE, path: '/' },
  { name: IMPERSONATE_COOKIE, path: '/' },
  { name: CSRF_COOKIE, path: '/' },
  { name: OAUTH_COOKIE, path: OAUTH_COOKIE_PATH },
  { name: THEME_COOKIE, path: '/' },
  { name: MODE_COOKIE, path: '/' },
  { name: LANG_COOKIE, path: '/' },
  { name: DIR_COOKIE, path: '/' },
  { name: SIDEBAR_COOKIE, path: '/' },
];
