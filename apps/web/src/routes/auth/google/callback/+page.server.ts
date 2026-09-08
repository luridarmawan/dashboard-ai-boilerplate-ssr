import { redirect } from '@sveltejs/kit';
import { cfgString } from '$lib/server/config';
import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, safeNext } from '$lib/server/oauth';
import { apiFor, csrfToken, forwardSetCookies, unwrap } from '$lib/server/session';
import type { PageServerLoad } from './$types';

/**
 * Sign in with Google, step 2 (A-8): Google sends the browser back here with `code` + `state`.
 * The state must match the cookie minted at /auth/google (that, plus PKCE, is what makes this
 * GET safe to accept cross-site); the API exchanges the code and answers like a password login —
 * a session cookie, or an MFA challenge that the login page's second step completes.
 */
export const load: PageServerLoad = async (event) => {
  const home = cfgString(event.locals.config, 'app.home_route', '/dashboard');
  if (event.locals.session) redirect(303, home);
  const csrf = csrfToken(event);
  const raw = event.cookies.get(OAUTH_COOKIE);
  event.cookies.delete(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });

  const q = event.url.searchParams;
  if (q.get('error')) {
    // The user pressed Cancel at Google (access_denied) or Google refused the request.
    return { csrf, error: q.get('error') === 'access_denied' ? 'cancelled' : 'provider' };
  }
  interface Kept {
    s?: string;
    v?: string;
    n?: string;
  }
  let kept: Kept | null = null;
  try {
    kept = raw ? (JSON.parse(raw) as Kept) : null;
  } catch {
    kept = null;
  }
  const code = q.get('code') ?? '';
  const state = q.get('state') ?? '';
  const verifier = kept?.v ?? '';
  const wanted = kept?.s ?? '';
  if (!wanted || !verifier || !code || !state || state !== wanted) return { csrf, error: 'state' };

  const res = await apiFor(event).v1.auth['google-login'].post({
    code,
    codeVerifier: verifier,
    redirectUri: `${event.url.origin}/auth/google/callback`,
  });
  const r = unwrap<{
    success: true;
    data: { mfaRequired?: true; challenge?: string; user?: unknown };
  }>(res);
  if (!r.ok) return { csrf, error: 'api', message: r.failure.message };
  const next = safeNext(kept?.n, home);
  if (r.data.data.mfaRequired && r.data.data.challenge)
    return { csrf, mfa: { challenge: r.data.data.challenge, next } };
  forwardSetCookies(event, res.response);
  redirect(303, next);
};
