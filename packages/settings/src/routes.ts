import { modulePublicRoutes } from '@core/module-kit/public-routes';
import { modules } from '@core/module-kit/registry';
import { webRoutes } from './generated/routes.ts';

/** Module namespace → module name, for the `/m/<ns>/…` dashboard pages. */
const nameByNs = new Map<string, string>(modules.map((m) => [m.ns, m.name] as const));

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

/**
 * The route registry (§4.7) narrowed to what a scope can actually reach: core pages plus the
 * pages of the modules in `enabled` (module NAMES, as `ModuleStateStore.enabledFor` returns
 * them). A `route` setting (landing, home) must neither offer nor accept a page of a module the
 * scope has disabled (G-8) — that page would only fall back or 404.
 */
export function routesForModules(enabled: ReadonlySet<string>): string[] {
  return webRoutes.filter((path) => {
    const owner = routeOwner(path);
    return owner === null || enabled.has(owner);
  });
}
