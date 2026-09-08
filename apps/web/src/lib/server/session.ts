import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { api } from '$lib/api/client';
import { hasPermission } from '$lib/permissions';

/**
 * Server-side glue between the browser and the API (Decision B, A-3, A-10, B-4, C-7):
 *   - `apiFor(event)`  a client that carries this browser's session and the CSRF pair
 *   - `loadSession()`  who is logged in, active tenant, tenants, effective permissions — for SSR
 *   - CSRF: a `dab_csrf` cookie on the browser + `_csrf` hidden field on every form; an action
 *     verifies them here first, then the API verifies its own pair. No JavaScript required.
 *   - `forwardSetCookies()` copies cookies the API set (login, logout) onto the browser.
 */

export const SESSION_COOKIE = 'dab_session';
export const CSRF_COOKIE = 'dab_csrf';
export const CSRF_FIELD = '_csrf';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  theme: string | null;
  isSuperadmin: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}
export interface TenantSummary {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}
export interface Session {
  user: SessionUser;
  clientId: string | null;
  tenants: TenantSummary[];
  permissions: string[];
  /** Cosmetic check for the UI (C-6b); the API is the authority. */
  can: (permission: string) => boolean;
}

const secure = (event: RequestEvent) =>
  event.url.protocol === 'https:' || process.env.NODE_ENV === 'production';

/** The browser's CSRF token, minting the cookie on first use. */
export function csrfToken(event: RequestEvent): string {
  let token = event.cookies.get(CSRF_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    // Same shape as the API's tokens (32 random bytes, base64url): it is forwarded as the
    // API's double-submit pair, and the API only accepts tokens that look like its own.
    token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    event.cookies.set(CSRF_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: secure(event),
      maxAge: 60 * 60 * 24,
    });
  }
  return token;
}

/** Verify the form's hidden token against the cookie; also refuse a foreign Origin. */
export function checkCsrf(event: RequestEvent, form: FormData): boolean {
  const cookie = event.cookies.get(CSRF_COOKIE);
  const field = form.get(CSRF_FIELD);
  if (!cookie || typeof field !== 'string' || field.length !== cookie.length) return false;
  let diff = 0;
  for (let i = 0; i < cookie.length; i++) diff |= cookie.charCodeAt(i) ^ field.charCodeAt(i);
  if (diff !== 0) return false;
  const origin = event.request.headers.get('origin') ?? event.request.headers.get('referer');
  if (!origin) return false;
  try {
    return new URL(origin).origin === event.url.origin;
  } catch {
    return false;
  }
}

/** The session (+csrf) cookies as one header value, for server-to-API calls made outside `apiFor`. */
export function sessionCookieHeader(cookies: Cookies): string | undefined {
  return cookieHeader(cookies);
}

function cookieHeader(cookies: Cookies): string | undefined {
  const parts: string[] = [];
  const s = cookies.get(SESSION_COOKIE);
  const c = cookies.get(CSRF_COOKIE);
  if (s) parts.push(`${SESSION_COOKIE}=${s}`);
  if (c) parts.push(`${CSRF_COOKIE}=${c}`);
  return parts.length ? parts.join('; ') : undefined;
}

/** API client bound to this browser: session cookie, CSRF pair, public origin, active tenant. */
export function apiFor(event: RequestEvent, clientId?: string | null) {
  let ip: string | undefined;
  try {
    ip = event.getClientAddress();
  } catch {
    ip = undefined;
  }
  return api({
    requestId: event.locals.requestId,
    cookie: cookieHeader(event.cookies),
    csrf: event.cookies.get(CSRF_COOKIE),
    origin: event.url.origin,
    clientId: clientId ?? null,
    // The API rate-limits per client IP (A-2); without this every browser would share the web server's IP.
    clientIp: ip,
  });
}

/**
 * Plain fetch to an API path (`/v1/...`) with the same identity headers as `apiFor` — for paths
 * only known at runtime (widget `data` hooks). Returns the envelope's `data`, or null on any failure.
 */
export async function apiFetchData<T = unknown>(
  event: RequestEvent,
  path: string,
  clientId?: string | null,
): Promise<T | null> {
  if (!path.startsWith('/v1/')) return null;
  const headers: Record<string, string> = {
    'x-request-id': event.locals.requestId,
    accept: 'application/json',
  };
  const cookie = cookieHeader(event.cookies);
  if (cookie) headers.cookie = cookie;
  const csrf = event.cookies.get(CSRF_COOKIE);
  if (csrf) headers['x-csrf-token'] = csrf;
  headers.origin = event.url.origin;
  headers['x-forwarded-proto'] = event.url.protocol.replace(':', '');
  headers['x-forwarded-host'] = event.url.host;
  if (clientId) headers['x-client-id'] = clientId;
  try {
    headers['x-forwarded-for'] = event.getClientAddress();
  } catch {
    /* not available (prerender) */
  }
  try {
    const res = await fetch(`${env.API_URL ?? 'http://127.0.0.1:3001'}${path}`, { headers });
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; data?: T };
    return body.success ? (body.data ?? null) : null;
  } catch {
    return null;
  }
}

/** Copy `Set-Cookie` from an API response onto the browser (session issued / cleared). */
export function forwardSetCookies(
  event: RequestEvent,
  response: Response | null | undefined,
): void {
  if (!response) return;
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (!pair || eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = decodeURIComponent(pair.slice(eq + 1).trim());
    const a: Record<string, string> = {};
    for (const at of attrs) {
      const [k, ...v] = at.trim().split('=');
      if (k) a[k.toLowerCase()] = v.join('=');
    }
    const opts = {
      path: a.path ?? '/',
      httpOnly: 'httponly' in a,
      sameSite: 'lax' as const,
      secure: secure(event),
      ...(a['max-age'] !== undefined ? { maxAge: Number(a['max-age']) } : {}),
      ...(a.expires ? { expires: new Date(a.expires) } : {}),
    };
    if (opts.maxAge === 0 || value === '') event.cookies.delete(name, { path: opts.path });
    else event.cookies.set(name, value, opts);
  }
}

/** Who is logged in, for hooks: one call to /me, one to /permissions (C-7). Null without a session. */
export async function loadSession(event: RequestEvent): Promise<Session | null> {
  if (!event.cookies.get(SESSION_COOKIE)) return null;
  const client = apiFor(event);
  const me = await client.v1.auth.me.get();
  if (!me.data?.success) {
    if (me.status === 401) event.cookies.delete(SESSION_COOKIE, { path: '/' });
    return null;
  }
  const perms = await client.v1.auth.permissions.get();
  const permissions = perms.data?.success ? perms.data.data.permissions : [];
  const user = me.data.data.user;
  const can = (p: string) => user.isSuperadmin || hasPermission(permissions, p);
  return { user, clientId: me.data.data.clientId, tenants: me.data.data.tenants, permissions, can };
}

/** Shape of the API failure envelope as Eden hands it back. */
export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Normalise an Eden result: `{ ok, data }` or `{ ok: false, failure }`. */
export function unwrap<T extends { success: true }>(r: {
  data: unknown;
  error: unknown;
  status: number;
}): { ok: true; data: T } | { ok: false; failure: ApiFailure } {
  const d = r.data as { success?: boolean } | null;
  if (d?.success) return { ok: true, data: d as T };
  const e = r.error as { status?: number; value?: unknown } | null;
  const env = (e?.value ?? r.data) as {
    error?: { code: string; message: string; details?: unknown };
  } | null;
  return {
    ok: false,
    failure: {
      status: e?.status ?? r.status ?? 500,
      code: env?.error?.code ?? 'internal_error',
      message: env?.error?.message ?? 'API tidak menjawab',
      details: env?.error?.details,
    },
  };
}

/** Standard action failure: keep what the user typed, show the API's message. */
export function actionFailure(
  f: ApiFailure,
  values: Record<string, unknown> = {},
  /** Extra page state to keep alongside the failure (e.g. which step of a flow the user is on). */
  extra: Record<string, unknown> = {},
) {
  return fail(f.status >= 400 && f.status < 600 ? f.status : 500, {
    error: f.message,
    code: f.code,
    details: f.details ?? null,
    values,
    ...extra,
  });
}

export const str = (form: FormData, key: string): string => {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
};
export const optStr = (form: FormData, key: string): string | undefined => {
  const v = form.get(key);
  return typeof v === 'string' && v !== '' ? v : undefined;
};
