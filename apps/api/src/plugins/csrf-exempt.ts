import { moduleCsrfExempt } from '@core/module-kit/csrf-exempt';

/**
 * Module API routes that skip the CSRF check (extension point 17, PRD A-10). The list is written
 * by `modules:sync` from each module's `csrf-exempt.ts`; core itself declares none.
 *
 * Matching is by method + the exact path shape: literal segments must be equal, `:param` matches
 * one non-empty segment. Anything that does not match — a trailing slash, an encoded slash, a
 * different method — falls back to the full check, so a near-miss fails closed.
 *
 * The other half of the contract lives in the auth plugin: an exempt request never carries a
 * cookie session (`isCsrfExempt` makes it anonymous), so the exemption cannot be used to act on
 * behalf of a logged-in visitor.
 */

export interface CsrfExemptEntry {
  readonly method: string;
  readonly path: string;
  readonly module: string;
  readonly ns: string;
  readonly reason: string;
}

interface Compiled extends CsrfExemptEntry {
  readonly re: RegExp;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileCsrfExempt(list: readonly CsrfExemptEntry[]): readonly Compiled[] {
  return list.map((e) => ({
    ...e,
    method: e.method.toUpperCase(),
    re: new RegExp(
      `^${e.path
        .split('/')
        .map((seg) => (seg.startsWith(':') ? '[^/]+' : escapeRe(seg)))
        .join('/')}$`,
    ),
  }));
}

/** Pure matcher — unit-tested with an explicit list; the plugins use the generated one. */
export function matchCsrfExempt(
  compiled: readonly Compiled[],
  method: string,
  pathname: string,
): CsrfExemptEntry | null {
  const m = method.toUpperCase();
  return compiled.find((e) => e.method === m && e.re.test(pathname)) ?? null;
}

const compiled = compileCsrfExempt(moduleCsrfExempt);

/** True when this request targets a route a module declared exempt from CSRF. */
export function isCsrfExempt(request: Request): boolean {
  if (compiled.length === 0) return false;
  return matchCsrfExempt(compiled, request.method, new URL(request.url).pathname) !== null;
}

/** The generated list, for the OpenAPI note and tests. */
export const csrfExemptRoutes: readonly CsrfExemptEntry[] = moduleCsrfExempt;

/**
 * State the exemption in the OpenAPI description of every exempt route, next to the permission
 * line `documentPermissions` writes, so the docs are derived from the list and cannot drift.
 */
export function documentCsrfExempt(app: {
  routes: readonly { method: string; path: string; hooks: object }[];
}) {
  for (const route of app.routes) {
    const entry = csrfExemptRoutes.find(
      (e) => e.method === route.method.toUpperCase() && e.path === route.path,
    );
    if (!entry) continue;
    const hooks = route.hooks as { detail?: Record<string, unknown> };
    const line = `Called by external systems: no CSRF check and no cookie session (a bearer token still counts). ${entry.reason}`;
    const description = hooks.detail?.description as string | undefined;
    if (description?.includes(line)) continue;
    hooks.detail = {
      ...hooks.detail,
      description: description ? `${description}\n\n${line}` : line,
    };
  }
}
