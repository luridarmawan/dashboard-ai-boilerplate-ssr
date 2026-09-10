import type { RequestEvent } from '@sveltejs/kit';
import { apiFor } from './session';

/**
 * Every group of the active tenant, for the pickers on the user pages.
 *
 * A list page of the API is capped at `MAX_LIMIT` = 100 rows (`apps/api/src/lib/http.ts`), so a
 * single call is not "all groups" — it is the first hundred. That truncation is not cosmetic on
 * these two pages: the user form submits exactly the boxes it rendered, and `setGroups()` replaces
 * a user's memberships with what arrives, so a group past the first page could not be granted AND
 * would be stripped from anyone who already had it the next time their profile was saved. Page
 * through instead; for all but the largest tenants this still costs one request.
 */
const PER_PAGE = 100;
/** 20 pages = 2000 groups. Past that a checkbox grid is the wrong control, not the wrong limit. */
const MAX_PAGES = 20;

export async function allGroups(event: RequestEvent) {
  const api = apiFor(event);
  const first = await api.v1.groups.get({ query: { limit: PER_PAGE, sort: 'name' } });
  if (!first.data?.success) return { ok: false as const, status: first.status };
  const rows = [...first.data.data];
  const pages = Math.min(first.data.meta.totalPages, MAX_PAGES);
  for (let p = 2; p <= pages; p++) {
    const next = await api.v1.groups.get({ query: { limit: PER_PAGE, sort: 'name', page: p } });
    // A page that fails leaves the picker short, which is exactly the bug above — say so instead.
    if (!next.data?.success) return { ok: false as const, status: next.status };
    rows.push(...next.data.data);
  }
  return { ok: true as const, rows };
}
