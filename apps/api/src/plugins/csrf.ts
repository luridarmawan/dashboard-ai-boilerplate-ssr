import { looksLikeToken, randomToken, timingSafeEqual } from '@core/auth';
import { env } from '@core/config';
import { fail } from '@core/contracts';
import { newId } from '@core/db';
import { Elysia } from 'elysia';

/**
 * CSRF protection for EVERY state-changing request (PRD A-10, anti-pattern D6).
 *
 * Two independent checks, both required for cookie-authenticated requests:
 *   1. Origin — the `Origin` (or `Referer`) header must match this deployment's origin.
 *   2. Double-submit — the `crk_csrf` cookie must equal the `x-csrf-token` header, compared in
 *      constant time. The API accepts the token in the HEADER only: browser forms post to
 *      SvelteKit (same origin, `_csrf` hidden field), and SvelteKit calls the API with the header.
 *
 * Runs in `onRequest`, BEFORE body parsing and schema validation, so a cross-origin request is
 * refused first and learns nothing — not even which fields were invalid.
 * Together with `SameSite=Lax` on the session cookie, a cross-site page cannot forge a
 * mutation. Requests that authenticate with a Bearer token (A-4) carry no cookie and are
 * exempt — that is the only exemption, and it is structural, not a per-route opt-out.
 *
 * There is no allowlist of "public" mutations: login and registration are protected too
 * (login CSRF is real). The web app fetches a token during SSR and posts it back.
 */

export const CSRF_COOKIE = 'crk_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_FIELD = '_csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfInput {
  readonly method: string;
  readonly origin: string | null;
  readonly referer: string | null;
  /** Origin this deployment is served from (scheme://host[:port]). */
  /** Origins this deployment is served from (Decision E); the request's Origin must be one of them. */
  readonly allowedOrigins: readonly string[];
  readonly hasBearer: boolean;
  readonly cookieToken: string | null;
  readonly headerToken: string | null;
}

export type CsrfVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: 'origin_missing' | 'origin_mismatch' | 'token_missing' | 'token_mismatch';
    };

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Pure decision — unit-tested; the plugin only feeds it request data. */
export function checkCsrf(i: CsrfInput): CsrfVerdict {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return { ok: true };
  if (i.hasBearer) return { ok: true };

  const allowed = i.allowedOrigins.map((o) => o.toLowerCase());
  const seen = originOf(i.origin) ?? originOf(i.referer);
  if (!seen) return { ok: false, reason: 'origin_missing' };
  if (!allowed.includes(seen)) return { ok: false, reason: 'origin_mismatch' };

  if (!looksLikeToken(i.cookieToken) || !i.headerToken)
    return { ok: false, reason: 'token_missing' };
  if (!timingSafeEqual(i.cookieToken, i.headerToken))
    return { ok: false, reason: 'token_mismatch' };
  return { ok: true };
}

/**
 * Origins a state-changing request may come from: the configured APP_ORIGIN list when set (one
 * installation may serve several domains), else the origin this request was served from — behind
 * Caddy that is the forwarded scheme + host (Decision E).
 */
export function allowedOrigins(request: Request): readonly string[] {
  const configured = env().APP_ORIGINS;
  if (configured.length) return configured;
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  return [`${proto}://${host}`.toLowerCase()];
}

/** First allowed origin — kept for callers that need a single value. */
export function requestOrigin(request: Request): string {
  return allowedOrigins(request)[0] ?? '';
}

export function isSecureRequest(request: Request): boolean {
  return (
    env().NODE_ENV === 'production' ||
    request.headers.get('x-forwarded-proto') === 'https' ||
    request.url.startsWith('https://')
  );
}

/** Common attributes for every cookie we set (A-3). */
export function cookieAttributes(request: Request) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: isSecureRequest(request), path: '/' };
}

/** Read one cookie from the raw header — `onRequest` runs before Elysia parses cookies. */
export function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export const csrf = new Elysia({ name: 'csrf' }).onRequest(({ request, set }) => {
  const verdict = checkCsrf({
    method: request.method,
    origin: request.headers.get('origin'),
    referer: request.headers.get('referer'),
    allowedOrigins: allowedOrigins(request),
    hasBearer: (request.headers.get('authorization') ?? '').toLowerCase().startsWith('bearer '),
    cookieToken: cookieValue(request, CSRF_COOKIE),
    headerToken: request.headers.get(CSRF_HEADER),
  });
  if (verdict.ok) return;
  set.status = 403;
  const rid = request.headers.get('x-request-id') ?? newId();
  set.headers['x-request-id'] = rid;
  return fail('csrf_failed', 'Permintaan ditolak oleh proteksi CSRF', rid, {
    reason: verdict.reason,
  });
});

/** Mint a token and set the cookie; returns the token for the response body / hidden field. */
export function issueCsrfToken(
  cookie: Record<string, { set: (o: Record<string, unknown>) => void }>,
  request: Request,
): string {
  const token = randomToken();
  cookie[CSRF_COOKIE]?.set({ value: token, ...cookieAttributes(request), maxAge: 60 * 60 * 24 });
  return token;
}
