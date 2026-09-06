import { error } from '@sveltejs/kit';
import { apiFor, unwrap } from '$lib/server/session';
import type { PageServerLoad } from './$types';

/** Users of the active tenant: search + paging through the URL, so it works without JS (D-1). */
export const load: PageServerLoad = async (event) => {
  const q = event.url.searchParams.get('q') ?? '';
  const page = Number(event.url.searchParams.get('page') ?? '1') || 1;
  const res = await apiFor(event).v1.users.get({
    query: { ...(q ? { q } : {}), page, limit: 20, sort: 'name' },
  });
  const r = unwrap<{
    success: true;
    data: unknown[];
    meta: { page: number; totalPages: number; total: number };
  }>(res);
  if (!r.ok) error(r.failure.status, r.failure.message);
  const data = res.data?.success ? res.data.data : [];
  return { q, users: data, meta: r.data.meta };
};
