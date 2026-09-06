import { fail, pageMeta } from '@core/contracts';
import type { SQL, Table, TenantDb } from '@core/db';
import { t } from 'elysia';

/** Route-level building blocks shared by the CRUD domains (N-4, N-5). */

/** Shared with the web forms (L-17); re-exported so route files keep one import site. */
export { Id } from '@core/contracts';

export const MAX_LIMIT = 100;

/** `?page&limit&q&sort&order` (D-1, N-5). Unknown sort keys fall back to the route's default. */
export const ListQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_LIMIT })),
  q: t.Optional(t.String({ maxLength: 191 })),
  sort: t.Optional(t.String({ maxLength: 32 })),
  order: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
});
export type ListQueryT = typeof ListQuery.static;

export interface Paging {
  readonly page: number;
  readonly limit: number;
  readonly offset: number;
  readonly q: string | null;
  readonly order: 'asc' | 'desc';
  meta(total: number): ReturnType<typeof pageMeta>;
}

export function paging(q: ListQueryT, defaultLimit = 20): Paging {
  const page = q.page ?? 1;
  const limit = Math.min(q.limit ?? defaultLimit, MAX_LIMIT);
  const search = q.q?.trim() || null;
  return {
    page,
    limit,
    offset: (page - 1) * limit,
    q: search,
    order: q.order ?? 'asc',
    meta: (total) => pageMeta(page, limit, total),
  };
}

/** The tenant condition for a hand-built query on a tenant table; throws for a global table. */
export function scopeOf(tenant: TenantDb, table: Table): SQL {
  const s = tenant.scope(table);
  if (!s) throw new Error('scopeOf(): tabel ini bukan tabel ber-tenant');
  return s;
}

export function notFound(set: { status?: number | string }, requestId: string, what: string) {
  set.status = 404;
  return fail('not_found', `${what} tidak ditemukan`, requestId);
}

export function conflict(set: { status?: number | string }, requestId: string, message: string) {
  set.status = 409;
  return fail('conflict', message, requestId);
}

/** Case-insensitive contains, dialect-neutral (`lower(col) like %q%`); PG has ilike, MySQL not. */
export function likePattern(q: string): string {
  return `%${q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}
