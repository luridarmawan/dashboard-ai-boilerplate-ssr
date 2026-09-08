import { redirect } from '@sveltejs/kit';
import { cfgBool } from '$lib/server/config';
import { apiFor, csrfToken, unwrap } from '$lib/server/session';
import type { RequestHandler } from './$types';

/** The transient OAuth state (state + PKCE verifier + where to go afterwards), httpOnly, 10 minutes. */
export const OAUTH_COOKIE = 'dab_oauth';
export const OAUTH_COOKIE_PATH = '/auth/google';

export function safeNext(next: string | null | undefined, home = '/dashboard'): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : home;
}

/**
 * Sign in with Google, step 1 (A-8): a plain link from the login page lands here; the API mints
 * the authorization URL + state + PKCE verifier, the browser keeps them in a cookie it cannot read
 * and is redirected to Google. No JavaScript involved.
 */
export const GET: RequestHandler = async (event) => {
  if (event.locals.session) redirect(303, safeNext(event.url.searchParams.get('next')));
  if (cfgBool(event.locals.config, 'security.google_enabled') !== true)
    redirect(303, '/auth/login?error=sso_disabled');
  // Mint the CSRF pair now: the callback's API call is a POST and must carry it.
  csrfToken(event);
  const redirectUri = `${event.url.origin}/auth/google/callback`;
  const r = unwrap<{
    success: true;
    data: { url: string; state: string; codeVerifier: string };
  }>(await apiFor(event).v1.auth.google.start.get({ query: { redirect_uri: redirectUri } }));
  if (!r.ok) redirect(303, `/auth/login?error=${encodeURIComponent(r.failure.code)}`);
  const payload = JSON.stringify({
    s: r.data.data.state,
    v: r.data.data.codeVerifier,
    n: safeNext(event.url.searchParams.get('next'), ''),
  });
  event.cookies.set(OAUTH_COOKIE, payload, {
    path: OAUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: event.url.protocol === 'https:' || process.env.NODE_ENV === 'production',
    maxAge: 600,
  });
  redirect(303, r.data.data.url);
};
