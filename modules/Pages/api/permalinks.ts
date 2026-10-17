import {
  activeDialect,
  and,
  type Db,
  eq,
  isNull,
  newId,
  schema,
  type TenantDb,
  tenantScope,
  unsafeAcrossTenants,
} from '@core/db';
import { SLUG_MAX } from './schemas.ts';

/**
 * Permalinks of the Pages module: who owns a slug, what a slug change does, and how a root URL
 * resolves. The rules, in one place:
 *
 *   - Within a tenant a slug belongs to ONE page (its current slug) or ONE redirect (an old slug
 *     of some page), never both. Creating or renaming onto a taken slug is a conflict.
 *   - Renaming a page that has EVER been published records its old slug as a redirect to the
 *     page. A page that was only ever a draft had no public URL, so nothing is recorded.
 *   - Redirects point at the page, not at a slug. Rename `/a` → `/b` → `/c` and both `/a` and
 *     `/b` answer 301 straight to `/c`: there is no chain to follow and no loop to fall into.
 *   - Renaming a page back to one of ITS OWN old slugs reclaims it: that redirect row is removed
 *     (it would otherwise point the URL at itself) and the slug becomes canonical again.
 *   - The slug update and the redirect insert run in ONE transaction: either both land or neither.
 *   - A redirect is only followed while its page is published; deleting a page deletes its
 *     redirects in the same transaction.
 */

type PageRow = typeof schema.pagesPages.$inferSelect;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSlug(value: string): boolean {
  return value.length > 0 && value.length <= SLUG_MAX && SLUG_RE.test(value);
}

/** `Tentang Kami — 2026!` → `tentang-kami-2026`; a title with no usable letters becomes `page`. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return slug || 'page';
}

/**
 * The one path segment a root URL may name (`/about-us`, `/about-us/`, `/About-Us`); null for
 * anything deeper, empty, or not slug-shaped — the 404 trapper hands over every unknown URL, and
 * most of them are not ours.
 */
export function rootSlug(path: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const segments = decoded.split('?')[0]?.split('/').filter(Boolean) ?? [];
  if (segments.length !== 1) return null;
  const slug = (segments[0] ?? '').toLowerCase();
  return isSlug(slug) ? slug : null;
}

export interface SlugChangeInput {
  readonly pageId: string;
  readonly current: string;
  readonly next: string;
  /** The page has been published at least once, so `current` may be bookmarked or indexed. */
  readonly everPublished: boolean;
  /** The page whose CURRENT slug is `next`, if any. */
  readonly pageOwner: string | null;
  /** The page an existing redirect FROM `next` points to, if any. */
  readonly redirectOwner: string | null;
}

export type SlugChangePlan =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'conflict'; readonly holder: 'page' | 'redirect' }
  | {
      readonly kind: 'change';
      /** `next` is one of this page's own old slugs: drop that redirect, it is canonical again. */
      readonly reclaim: boolean;
      /** Record `current` as a redirect to this page. */
      readonly redirectOld: boolean;
    };

/** What a slug change must do — pure, so every branch is unit-tested without a database. */
export function planSlugChange(input: SlugChangeInput): SlugChangePlan {
  if (input.next === input.current) return { kind: 'unchanged' };
  if (input.pageOwner && input.pageOwner !== input.pageId)
    return { kind: 'conflict', holder: 'page' };
  if (input.redirectOwner && input.redirectOwner !== input.pageId)
    return { kind: 'conflict', holder: 'redirect' };
  return {
    kind: 'change',
    reclaim: input.redirectOwner === input.pageId,
    redirectOld: input.everPublished,
  };
}

/** Thrown inside a transaction so it rolls back; the route turns it into a 409. */
export class SlugConflictError extends Error {
  override name = 'SlugConflictError';
  constructor(
    readonly slug: string,
    readonly holder: 'page' | 'redirect',
  ) {
    super(`slug "${slug}" is taken by a ${holder}`);
  }
}

/** Who holds `slug` in this tenant right now. Deleted pages are included: their slug was freed on delete, so one that still holds it is a conflict, not a crash. */
export async function slugHolders(
  tenant: TenantDb,
  slug: string,
): Promise<{ page: string | null; redirect: string | null }> {
  const page = await tenant.selectOne(schema.pagesPages, eq(schema.pagesPages.slug, slug));
  const redirect = await tenant.selectOne(
    schema.pagesRedirects,
    eq(schema.pagesRedirects.old_slug, slug),
  );
  return { page: page?.id ?? null, redirect: redirect?.page_id ?? null };
}

/** Refuse a slug for a NEW page when any page or redirect already holds it. */
export async function assertSlugFree(tenant: TenantDb, slug: string): Promise<void> {
  const holders = await slugHolders(tenant, slug);
  if (holders.page) throw new SlugConflictError(slug, 'page');
  if (holders.redirect) throw new SlugConflictError(slug, 'redirect');
}

export interface SlugChangeResult {
  readonly changed: boolean;
  /** The old slug now redirects (301) to the new one. */
  readonly redirected: boolean;
  readonly from: string;
  readonly to: string;
}

/**
 * Move `page` to `next`. Call inside `inTransaction()`: a conflict throws, and a failing write
 * (e.g. a unique index refusing a racing insert) throws too, so the slug update never survives
 * without its redirect, and a redirect is never written for a slug change that did not happen.
 */
export async function applySlugChange(
  tenant: TenantDb,
  page: Pick<PageRow, 'id' | 'slug' | 'published_at'>,
  next: string,
): Promise<SlugChangeResult> {
  const holders = await slugHolders(tenant, next);
  const plan = planSlugChange({
    pageId: page.id,
    current: page.slug,
    next,
    everPublished: page.published_at !== null,
    pageOwner: holders.page,
    redirectOwner: holders.redirect,
  });
  if (plan.kind === 'unchanged')
    return { changed: false, redirected: false, from: page.slug, to: next };
  if (plan.kind === 'conflict') throw new SlugConflictError(next, plan.holder);
  if (plan.reclaim)
    await tenant.delete(schema.pagesRedirects, eq(schema.pagesRedirects.old_slug, next));
  await tenant.update(schema.pagesPages, { slug: next }, eq(schema.pagesPages.id, page.id));
  if (plan.redirectOld)
    await tenant.insert(schema.pagesRedirects, {
      id: newId(),
      page_id: page.id,
      old_slug: page.slug,
    });
  return { changed: true, redirected: plan.redirectOld, from: page.slug, to: next };
}

/** The old slugs that currently redirect to a page, oldest first. */
export async function redirectsOf(
  tenant: TenantDb,
  pageId: string,
): Promise<{ oldSlug: string; createdAt: string }[]> {
  const rows = await tenant.select(
    schema.pagesRedirects,
    eq(schema.pagesRedirects.page_id, pageId),
  );
  return rows
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    .map((r) => ({ oldSlug: r.old_slug, createdAt: r.created_at.toISOString() }));
}

export type Resolution = { kind: 'page'; page: PageRow } | { kind: 'redirect'; page: PageRow };

/**
 * What a root URL names: a published page (render it), an old permalink of a published page
 * (301 to its current slug), or nothing (404). Two indexed lookups at most, three on a redirect.
 */
export async function resolvePath(tenant: TenantDb, path: string): Promise<Resolution | null> {
  const slug = rootSlug(path);
  if (!slug) return null;
  const published = (extra: ReturnType<typeof eq>) =>
    tenant.selectOne(
      schema.pagesPages,
      and(extra, eq(schema.pagesPages.status, 'published'), isNull(schema.pagesPages.deleted_at)),
    );
  const page = await published(eq(schema.pagesPages.slug, slug));
  if (page) return { kind: 'page', page };
  const redirect = await tenant.selectOne(
    schema.pagesRedirects,
    eq(schema.pagesRedirects.old_slug, slug),
  );
  if (!redirect) return null;
  // A redirect to a page that is no longer published is inactive: 404, never a 301 into a 404.
  const target = await published(eq(schema.pagesPages.id, redirect.page_id));
  return target ? { kind: 'redirect', page: target } : null;
}

/**
 * Run `fn` in one database transaction, with the tenant facade bound to it. MySQL, MariaDB and
 * PostgreSQL roll everything back when `fn` throws. bun:sqlite cannot hold a transaction open
 * across `await`, so on SQLite (a single-process development database) the statements run in
 * sequence without one: the conflict checks still run before anything is written, but a write
 * that fails halfway is not undone there.
 */
export async function inTransaction<T>(
  clientId: string,
  fn: (tenant: TenantDb) => Promise<T>,
): Promise<T> {
  // Cross-tenant only in name: the handle is immediately re-bound to ONE tenant by tenantScope.
  const db = unsafeAcrossTenants();
  if ((activeDialect as string) === 'sqlite') return fn(tenantScope(db, clientId));
  const tx = db as unknown as {
    transaction<R>(run: (handle: unknown) => Promise<R>): Promise<R>;
  };
  return tx.transaction((handle) => fn(tenantScope(handle as Db, clientId)));
}

/** True when a driver error (or its cause) is a unique-index violation, on any supported dialect. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    const x = e as { code?: unknown; errno?: unknown; cause?: unknown };
    if (x.code === 'ER_DUP_ENTRY' || x.errno === 1062 || x.code === '23505') return true;
    if (typeof x.code === 'string' && x.code.startsWith('SQLITE_CONSTRAINT')) return true;
    e = x.cause;
  }
  return false;
}
