import type { App } from '@app/api/app';
import { treaty } from '@elysiajs/eden';
import { env } from '$env/dynamic/private';

/**
 * The typed API client (N-3). Server-side only: `load` functions and form actions call the API
 * with the browser's session cookie, the request id (one id web → API → log, M-1), the active
 * tenant and — for mutations — the CSRF pair the API expects (A-10). A breaking API change
 * fails `bun run typecheck` here, not at runtime.
 */
export interface ApiContext {
  readonly requestId: string;
  /** Raw `Cookie` header to forward (session + csrf), if any. */
  readonly cookie?: string | undefined;
  /** Double-submit token; sent as the header half of the pair. */
  readonly csrf?: string | undefined;
  /** The browser-facing origin; the API validates Origin against it (Decision E). */
  readonly origin?: string | undefined;
  readonly clientId?: string | null | undefined;
}

export function api(ctx: ApiContext | string) {
  const c: ApiContext = typeof ctx === 'string' ? { requestId: ctx } : ctx;
  const headers: Record<string, string> = { 'x-request-id': c.requestId };
  if (c.cookie) headers.cookie = c.cookie;
  if (c.csrf) headers['x-csrf-token'] = c.csrf;
  if (c.origin) {
    // The web server stands where the reverse proxy stands: tell the API which public origin
    // this request belongs to, so its Origin check compares like with like.
    const u = new URL(c.origin);
    headers.origin = u.origin;
    headers['x-forwarded-proto'] = u.protocol.replace(':', '');
    headers['x-forwarded-host'] = u.host;
  }
  if (c.clientId) headers['x-client-id'] = c.clientId;
  return treaty<App>(env.API_URL ?? 'http://127.0.0.1:3001', { headers });
}

export type Api = ReturnType<typeof api>;
