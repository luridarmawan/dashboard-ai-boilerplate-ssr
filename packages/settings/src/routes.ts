import { rawEnv } from '@core/config';
import { modulePublicRoutes } from '@core/module-kit/public-routes';
import { modules } from '@core/module-kit/registry';
import { publicWebRoutes, webRoutes } from './generated/routes.ts';

/** Module namespace → module name, for the `/m/<ns>/…` dashboard pages. */
const nameByNs = new Map<string, string>(modules.map((m) => [m.ns, m.name] as const));

/** Root of the built-in page-pattern gallery (L-19), switched off with EXAMPLE_PAGE_ENABLE=false. */
const EXAMPLE_PAGES = '/examples';

/**
 * Name of the module that owns a web path, or null for a core page. Dashboard pages live under
 * `/m/<ns>/…` (extension point 3); public pages are whatever `public.ts` declared (extension
 * point 13), matched as a prefix so `/product/[slug]` also claims `/product/x`.
 */
export function routeOwner(path: string): string | null {
  const m = /^\/m\/([a-z][a-z0-9]*)(\/|$)/.exec(path);
  if (m) return nameByNs.get(m[1] ?? '') ?? null;
  for (const r of modulePublicRoutes) {
    const re = new RegExp(`^${r.path.replace(/\[[^\]]+\]/g, '[^/]+')}(/|$)`);
    if (re.test(path)) return r.module;
  }
  return null;
}

/** Whether a path belongs to the pattern gallery — `/examples` and everything under it. */
function isExamplePage(path: string): boolean {
  return path === EXAMPLE_PAGES || path.startsWith(`${EXAMPLE_PAGES}/`);
}

/**
 * The route registry (§4.7) narrowed to what a scope can actually reach: core pages plus the
 * pages of the modules in `enabled` (module NAMES, as `ModuleStateStore.enabledFor` returns
 * them). A `route` setting (landing, home) must neither offer nor accept a page of a module the
 * scope has disabled (G-8) — that page would only fall back or 404. The pattern gallery is
 * dropped the same way when the deployment turned it off (EXAMPLE_PAGE_ENABLE=false, L-19): the
 * web answers 404 there, so offering it would be the same broken choice.
 */
export function routesForModules(enabled: ReadonlySet<string>): string[] {
  return narrow(webRoutes, enabled);
}

/**
 * The same narrowing over the ANONYMOUS-reachable routes only (§4.7). `app.landing_route` picks
 * from this list: `/` is served to a visitor with no session, so a page behind the `(app)` layout
 * would only redirect them to /auth/login — the front door would never show what it was set to.
 * Pointing the landing at `/auth/login` itself stays possible, and is the documented way to run a
 * deployment with no public side at all (§4.7 rule 4).
 */
export function publicRoutesForModules(enabled: ReadonlySet<string>): string[] {
  return narrow(publicWebRoutes, enabled);
}

function narrow(list: readonly string[], enabled: ReadonlySet<string>): string[] {
  const examplePages = rawEnv('EXAMPLE_PAGE_ENABLE') !== 'false';
  return list.filter((path) => {
    if (!examplePages && isExamplePage(path)) return false;
    const owner = routeOwner(path);
    return owner === null || enabled.has(owner);
  });
}
