/**
 * Sign in with Google (A-8), web side: the transient state shared by /auth/google (start) and
 * /auth/google/callback. Kept here because a `+server.ts` may only export request handlers.
 */

/** state + PKCE verifier + where to go afterwards, httpOnly, 10 minutes, scoped to the flow's path. */
export const OAUTH_COOKIE = 'dab_oauth';
export const OAUTH_COOKIE_PATH = '/auth/google';

export function safeNext(next: string | null | undefined, home = '/dashboard'): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : home;
}
