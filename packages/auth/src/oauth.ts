import { randomToken } from './tokens.ts';

/**
 * OAuth 2.0 / OpenID Connect primitives for social login (PRD A-8). Pure functions, no network:
 * PKCE (RFC 7636, S256), the Google authorization URL, and the e-mail domain allowlist. The
 * exchange itself (code → tokens → identity) lives in the API domain, where the client secret is.
 */

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/** base64url(SHA-256(verifier)) — the S256 code challenge. */
export function pkceChallenge(verifier: string): string {
  const digest = new Bun.CryptoHasher('sha256').update(verifier).digest();
  return Buffer.from(digest).toString('base64url');
}

/** A fresh verifier (43 chars, inside RFC 7636's 43–128) with its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken();
  return { verifier, challenge: pkceChallenge(verifier) };
}

export interface GoogleAuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** Google Workspace hint: only accounts of this domain are offered (`hd`). Enforced server-side too. */
  hostedDomain?: string | undefined;
  loginHint?: string | undefined;
}

/** The URL the browser is sent to. `openid email profile` is the minimum for an identity. */
export function googleAuthorizeUrl(p: GoogleAuthorizeParams): string {
  const u = new URL(GOOGLE_AUTHORIZE_URL);
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  // Always ask which account: a shared computer must not silently reuse the last Google session.
  u.searchParams.set('prompt', 'select_account');
  if (p.hostedDomain) u.searchParams.set('hd', p.hostedDomain);
  if (p.loginHint) u.searchParams.set('login_hint', p.loginHint);
  return u.toString();
}

/** `"example.com, other.id"` → `['example.com', 'other.id']` (lower-cased, empty entries dropped). */
export function parseDomainList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/** An empty allowlist admits every domain; otherwise the e-mail's domain must match exactly. */
export function emailDomainAllowed(email: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowed.includes(domain);
}

/** What the API needs from the identity provider once the code has been exchanged. */
export interface OAuthIdentity {
  /** The provider's stable subject id — the link key, never the e-mail. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
  /** Google Workspace domain when the account belongs to one. */
  hostedDomain: string | null;
}

/** Normalise Google's `userinfo` document; anything malformed becomes null. */
export function parseGoogleUserinfo(raw: unknown): OAuthIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sub = typeof r.sub === 'string' ? r.sub : '';
  const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
  if (!sub || !email?.includes('@')) return null;
  const verified = r.email_verified === true || r.email_verified === 'true';
  const name =
    typeof r.name === 'string' && r.name.trim() ? r.name.trim() : email.split('@')[0] || email;
  return {
    sub,
    email,
    emailVerified: verified,
    name: name.slice(0, 191),
    avatarUrl:
      typeof r.picture === 'string' && /^https:\/\//.test(r.picture)
        ? r.picture.slice(0, 512)
        : null,
    hostedDomain: typeof r.hd === 'string' && r.hd ? r.hd.toLowerCase() : null,
  };
}
