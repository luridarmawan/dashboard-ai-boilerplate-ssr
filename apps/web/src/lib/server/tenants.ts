import type { RequestEvent } from '@sveltejs/kit';
import { apiFor } from './session';

export interface TenantOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly parentId: string | null;
}

/** One API page is capped at 100 rows (`MAX_LIMIT`); page through like `allGroups` does. */
const PER_PAGE = 100;
/** 20 pages = 2000 tenants. Past that a <select> is the wrong control, not the wrong limit. */
const MAX_PAGES = 20;

/**
 * Tenants the caller may act in, as the "parent tenant" choices of the tenant forms. The API
 * already narrows the list by membership (a superadmin sees every live tenant), so a parent a
 * user cannot act in never shows up — and the API refuses it anyway.
 *
 * With `exclude`, the tenant being edited and everything under it are dropped: moving a tenant
 * under its own sub-tenant would close a loop. The API refuses that too; filtering here keeps the
 * picker honest instead of offering choices that fail on submit.
 */
export async function parentCandidates(
  event: RequestEvent,
  exclude?: string,
): Promise<TenantOption[]> {
  const api = apiFor(event);
  const first = await api.v1.clients.get({ query: { limit: PER_PAGE, sort: 'name' } });
  if (!first.data?.success) return [];
  const rows: TenantOption[] = [...first.data.data];
  const pages = Math.min(first.data.meta.totalPages, MAX_PAGES);
  for (let p = 2; p <= pages; p++) {
    const next = await api.v1.clients.get({ query: { limit: PER_PAGE, sort: 'name', page: p } });
    if (!next.data?.success) break;
    rows.push(...next.data.data);
  }
  if (!exclude) return rows;
  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
  }
  const subtree = new Set<string>([exclude]);
  const stack = [exclude];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const child of children.get(id) ?? []) {
      if (subtree.has(child)) continue;
      subtree.add(child);
      stack.push(child);
    }
  }
  return rows.filter((r) => !subtree.has(r.id));
}

/** `<select>` options for a parent picker; the empty "no parent" choice is added by the form. */
export function parentOptions(rows: readonly TenantOption[]) {
  return rows.map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }));
}
