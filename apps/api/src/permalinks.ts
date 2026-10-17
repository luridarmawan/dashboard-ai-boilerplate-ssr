import { isPermalinkPath, normalizePermalink } from '@core/contracts';
import {
  and,
  eq,
  forTenant,
  isNull,
  newId,
  schema,
  type TenantDb,
  unsafeAcrossTenants,
} from '@core/db';
import { modulePublicRoutes } from '@core/module-kit/public-routes';
import { webRoutes } from '@core/settings';

/**
 * The permalink registry (PRD F-12) — how a module gets URLs at the root of the site without
 * being "the" 404 handler. A module registers the path of each piece of content it owns, inside
 * its own transaction (`inTransaction` from `@core/db`):
 *
 *   claimPermalink(tx, { module: 'pages', target: page.id, path: '/about-us', live, keepHistory })
 *   setPermalinkLive(tx, 'pages', page.id, false)     // unpublished: reserved, not served
 *   releasePermalinks(tx, 'pages', page.id)            // deleted: every URL becomes free (404)
 *
 * The web asks `GET /v1/permalinks/resolve` for every URL no route matches — one indexed query —
 * and either renders the module's permalink page (declared `permalinks: true` in public.ts),
 * answers 301 (an old path, or the right path written loosely), or moves on to the 404 handler.
 *
 * The rules, in one place:
 *   - a path belongs to ONE row per tenant (unique index): no two modules, no two contents, share
 *     a URL; claiming a taken path is a conflict, never an overwrite
 *   - each (module, target) has one canonical path; its old paths are `redirect` rows naming the
 *     target, so `/a` → `/b` → `/c` leaves both `/a` and `/b` answering 301 straight to `/c`
 *   - `keepHistory` (the content has been public) turns the old canonical into a redirect;
 *     without it, the old path is simply released
 *   - claiming one of the target's own old paths reclaims it (no redirect onto itself)
 *   - nothing under a core prefix, and no path a SvelteKit route already answers
 */

export type PermalinkHolder = 'content' | 'redirect' | 'route';

/** Thrown inside the caller's transaction so it rolls back; routes turn it into a 409. */
export class PermalinkConflictError extends Error {
  override name = 'PermalinkConflictError';
  constructor(
    readonly path: string,
    readonly holder: PermalinkHolder,
    /** The module holding the path, when another content holds it. */
    readonly module: string | null = null,
  ) {
    super(`permalink "${path}" is taken (${holder}${module ? `, ${module}` : ''})`);
  }
}

export interface PermalinkClaim {
  readonly module: string;
  readonly target: string;
  /** Wanted path, in any reasonable spelling (`about-us`, `/About-Us/`). */
  readonly path: string;
  /** Served to visitors now. */
  readonly live: boolean;
  /** The current path has been public: keep it as a 301 to the new one. */
  readonly keepHistory: boolean;
}

export interface PermalinkChange {
  readonly changed: boolean;
  /** The previous path now answers 301 to the new one. */
  readonly redirected: boolean;
  readonly from: string | null;
  readonly to: string;
}

/** Holders of a path, as `planClaim` needs them. */
export interface PathHolders {
  /** (module, target) of the row holding the path, and whether it is a redirect. */
  readonly row: { module: string; target: string; kind: string } | null;
}

export type ClaimPlan =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'conflict'; readonly holder: PermalinkHolder; readonly module: string | null }
  | {
      readonly kind: 'move';
      /** The wanted path is one of this target's own redirects: drop it, it is canonical again. */
      readonly reclaim: boolean;
      /** Turn the current canonical into a redirect (else delete it). */
      readonly redirectOld: boolean;
    };

/** What a claim must do — pure, so every branch is unit-tested without a database. */
export function planClaim(input: {
  module: string;
  target: string;
  current: string | null;
  next: string;
  keepHistory: boolean;
  holder: PathHolders['row'];
}): ClaimPlan {
  if (input.current === input.next) return { kind: 'unchanged' };
  const own = input.holder?.module === input.module && input.holder.target === input.target;
  if (input.holder && !own)
    return {
      kind: 'conflict',
      holder: input.holder.kind === 'redirect' ? 'redirect' : 'content',
      module: input.holder.module,
    };
  return {
    kind: 'move',
    reclaim: own && input.holder?.kind === 'redirect',
    redirectOld: input.current !== null && input.keepHistory,
  };
}

/** SvelteKit routes with params, as patterns: `/product/[slug]` → /^\/product\/[^/]+$/. */
const PARAM_ROUTES = modulePublicRoutes
  .filter((r) => r.path.includes('['))
  .map((r) => new RegExp(`^${r.path.replace(/\[[^\]]+\]/g, '[^/]+')}$`));

/** A path some page of the app already answers — a permalink there would never be reached. */
export function isRoutePath(path: string): boolean {
  return webRoutes.includes(path) || PARAM_ROUTES.some((re) => re.test(path));
}

/** The canonical form of a wanted path, or null when it can never be a permalink. */
export function permalinkPath(raw: string): string | null {
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const path = withSlash.replace(/\/+$/, '').toLowerCase();
  return isPermalinkPath(path) ? path : null;
}

type Row = typeof schema.permalinks.$inferSelect;

async function rowAt(tenant: TenantDb, path: string): Promise<Row | null> {
  return tenant.selectOne(schema.permalinks, eq(schema.permalinks.path, path));
}

async function canonicalOf(tenant: TenantDb, module: string, target: string): Promise<Row | null> {
  return tenant.selectOne(
    schema.permalinks,
    and(
      eq(schema.permalinks.module, module),
      eq(schema.permalinks.target, target),
      eq(schema.permalinks.kind, 'canonical'),
    ),
  );
}

/** Refuse a path for NEW content when anything already holds it. */
export async function assertPermalinkFree(tenant: TenantDb, rawPath: string): Promise<string> {
  const path = permalinkPath(rawPath);
  if (!path || isRoutePath(path)) throw new PermalinkConflictError(rawPath, 'route');
  const row = await rowAt(tenant, path);
  if (row)
    throw new PermalinkConflictError(
      path,
      row.kind === 'redirect' ? 'redirect' : 'content',
      row.module,
    );
  return path;
}

/**
 * Give (module, target) the canonical `path`. Call inside `inTransaction()`: a conflict throws,
 * and a write the unique index refuses (a racing claim) throws too, so the caller's own change
 * and the registry never disagree.
 */
export async function claimPermalink(
  tenant: TenantDb,
  claim: PermalinkClaim,
): Promise<PermalinkChange> {
  const next = permalinkPath(claim.path);
  if (!next || isRoutePath(next)) throw new PermalinkConflictError(claim.path, 'route');
  const current = await canonicalOf(tenant, claim.module, claim.target);
  const holder = await rowAt(tenant, next);
  const plan = planClaim({
    module: claim.module,
    target: claim.target,
    current: current?.path ?? null,
    next,
    keepHistory: claim.keepHistory,
    holder: holder ? { module: holder.module, target: holder.target, kind: holder.kind } : null,
  });
  if (plan.kind === 'conflict') throw new PermalinkConflictError(next, plan.holder, plan.module);
  if (plan.kind === 'unchanged') {
    if (current && current.live !== claim.live)
      await setPermalinkLive(tenant, claim.module, claim.target, claim.live);
    return { changed: false, redirected: false, from: current?.path ?? null, to: next };
  }
  if (plan.reclaim) await tenant.delete(schema.permalinks, eq(schema.permalinks.path, next));
  if (current) {
    if (plan.redirectOld)
      await tenant.update(
        schema.permalinks,
        { kind: 'redirect' },
        eq(schema.permalinks.id, current.id),
      );
    else await tenant.delete(schema.permalinks, eq(schema.permalinks.id, current.id));
  }
  await tenant.insert(schema.permalinks, {
    id: newId(),
    path: next,
    module: claim.module,
    target: claim.target,
    kind: 'canonical',
    live: claim.live,
  });
  // Redirects follow their target's visibility: a draft's old URLs are 404 too.
  await setPermalinkLive(tenant, claim.module, claim.target, claim.live);
  return { changed: true, redirected: plan.redirectOld, from: current?.path ?? null, to: next };
}

/** Publish / unpublish every URL of a target at once (canonical and redirects). */
export async function setPermalinkLive(
  tenant: TenantDb,
  module: string,
  target: string,
  live: boolean,
): Promise<void> {
  await tenant.update(
    schema.permalinks,
    { live },
    and(eq(schema.permalinks.module, module), eq(schema.permalinks.target, target)),
  );
}

/** The content is gone: free every path it held. */
export async function releasePermalinks(
  tenant: TenantDb,
  module: string,
  target: string,
): Promise<void> {
  await tenant.delete(
    schema.permalinks,
    and(eq(schema.permalinks.module, module), eq(schema.permalinks.target, target)),
  );
}

/** The old paths that redirect to a target, oldest first. */
export async function permalinkRedirects(
  tenant: TenantDb,
  module: string,
  target: string,
): Promise<{ path: string; createdAt: string }[]> {
  const rows = await tenant.select(
    schema.permalinks,
    and(
      eq(schema.permalinks.module, module),
      eq(schema.permalinks.target, target),
      eq(schema.permalinks.kind, 'redirect'),
    ),
  );
  return rows
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    .map((r) => ({ path: r.path, createdAt: r.created_at.toISOString() }));
}

export type PermalinkHit =
  | {
      readonly kind: 'content';
      readonly module: string;
      readonly target: string;
      readonly path: string;
    }
  | {
      readonly kind: 'redirect';
      readonly module: string;
      readonly target: string;
      readonly location: string;
    };

/**
 * What a visitor's URL names in a tenant: live content (its canonical path may differ from the
 * spelling asked for — the caller redirects to it), an old path of live content, or nothing.
 */
export async function resolvePermalink(
  clientId: string,
  rawPath: string,
): Promise<PermalinkHit | null> {
  const path = normalizePermalink(rawPath);
  if (!path) return null;
  const tenant = forTenant(clientId);
  const row = await rowAt(tenant, path);
  if (!row?.live) return null;
  if (row.kind === 'canonical')
    return { kind: 'content', module: row.module, target: row.target, path: row.path };
  const canonical = await canonicalOf(tenant, row.module, row.target);
  if (!canonical?.live) return null;
  return { kind: 'redirect', module: row.module, target: row.target, location: canonical.path };
}

/** Live canonical paths of a tenant, for sitemap.xml. */
export async function livePermalinks(
  clientId: string,
): Promise<{ path: string; module: string; lastmod: string }[]> {
  const rows = await forTenant(clientId).select(
    schema.permalinks,
    and(eq(schema.permalinks.kind, 'canonical'), eq(schema.permalinks.live, true)),
  );
  return rows.map((r) => ({ path: r.path, module: r.module, lastmod: r.updated_at.toISOString() }));
}

let defaultTenantId: string | null = null;
/**
 * The tenant whose site an anonymous visitor sees: the one named by session / X-Client-ID, else
 * the `default` tenant — one installation, one public site per tenant.
 */
export async function siteTenant(clientId: string | null): Promise<string | null> {
  if (clientId) return clientId;
  if (defaultTenantId) return defaultTenantId;
  const [row] = await unsafeAcrossTenants() // looking a tenant up by its code is cross-tenant by definition
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.code, 'default'), isNull(schema.clients.deleted_at)))
    .limit(1);
  defaultTenantId = row?.id ?? null;
  return defaultTenantId;
}
