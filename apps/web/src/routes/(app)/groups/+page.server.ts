import { error } from '@sveltejs/kit';
import { tableStateFrom } from '$lib/components/table';
import { apiFor, unwrap } from '$lib/server/session';
import type { PageServerLoad } from './$types';

/** Groups of the active tenant. The URL is the table state; `load` fetches, DataTable renders. */
export const load: PageServerLoad = async (event) => {
  const st = tableStateFrom(event.url, { sort: 'name' });
  const res = await apiFor(event).v1.groups.get({
    query: { ...(st.q ? { q: st.q } : {}), page: st.page, limit: st.limit, sort: st.sort, order: st.order },
  });
  const r = unwrap<{
    success: true;
    data: unknown[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }>(res);
  if (!r.ok) error(r.failure.status, r.failure.message);
  const groups = res.data?.success ? res.data.data : [];
  return {
    groups,
    state: { ...st, total: r.data.meta.total, totalPages: r.data.meta.totalPages },
  };
};
