import type { RequestEvent } from '@sveltejs/kit';

/**
 * The 404 trapper (PRD §4.7 rule 6, F-11): a request that matches no route is offered to the
 * module page named by `app.not_found_route` before the built-in 404 renders. The page is
 * fetched internally, so it needs to be told which URL the visitor actually asked for — that
 * travels in ONE header, read back here by `trappedPath()`. The landing forward (F-5) uses the
 * same header, so a forwarded page always knows the address the visitor sees.
 */
export const ORIGINAL_PATH_HEADER = 'x-original-path';

export interface TrappedPath {
  readonly pathname: string;
  readonly search: string;
}

/**
 * Prefixes that are never handed to a module as a 404 handler: assets, the API, core groups,
 * and the well-known files crawlers and scanners ask for. Whatever falls under these is either
 * served by something else or is a genuine 404 — a module lookup would only cost a query.
 */
export const NEVER_TRAPPED: readonly string[] = [
  '/_app',
  '/v1',
  '/api',
  '/m',
  '/auth',
  '/dashboard',
  '/files',
  '/join',
  '/docs',
  '/metrics',
  '/settings',
  '/modules',
  '/users',
  '/groups',
  '/tenants',
  '/profile',
  '/examples',
  '/notifications',
  '/outbox',
  '/queue',
  '/webhooks',
  '/themes',
  '/permissions',
  '/theme',
  '/lang',
  '/sidebar',
  '/.well-known',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
];

/** True when the path is under a prefix the trapper must leave alone (or has a dot-file segment). */
export function isNeverTrapped(pathname: string): boolean {
  if (NEVER_TRAPPED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  return pathname.split('/').some((seg) => seg.startsWith('.'));
}

/** Only navigations are trapped: a client that does not ask for HTML gets the plain 404. */
export function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html') || accept.includes('application/xhtml+xml');
}

/** Parse the header value; anything that is not an absolute path on this origin is ignored. */
export function parseOriginalPath(raw: string | null): TrappedPath | null {
  if (!raw?.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  const q = raw.indexOf('?');
  const pathname = q < 0 ? raw : raw.slice(0, q);
  const search = q < 0 ? '' : raw.slice(q);
  if (pathname.includes('\n') || pathname.includes('\r')) return null;
  return { pathname, search };
}

/**
 * The URL the visitor requested when this page renders on their behalf (404 trapper or landing
 * forward); null on a direct visit. A module page acting as a 404 handler uses this to decide
 * what to show — and answers `error(404)` when it is null, because it has no page of its own.
 */
export function trappedPath(event: Pick<RequestEvent, 'request'>): TrappedPath | null {
  return parseOriginalPath(event.request.headers.get(ORIGINAL_PATH_HEADER));
}
