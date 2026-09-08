import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { tableStateFrom } from '$lib/components/table';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/**
 * A wide table: ask the theme for its `wide` layout (Decision K). The page never names a layout id.
 * SvelteKit only allows custom page-module exports with a `_` prefix, hence `_layoutVariant`.
 */
export const _layoutVariant = 'wide';

const SORTABLE = new Set(['name', 'email', 'created_at', 'last_login_at']);

/** Users of the active tenant (D-1). The URL is the table state; `load` fetches, DataTable renders. */
export const load: PageServerLoad = async (event) => {
  const st = tableStateFrom(event.url, { sort: 'name' });
  const sort = SORTABLE.has(st.sort) ? st.sort : 'name';
  const res = await apiFor(event).v1.users.get({
    query: { ...(st.q ? { q: st.q } : {}), page: st.page, limit: st.limit, sort, order: st.order },
  });
  const r = unwrap<{
    success: true;
    data: unknown[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }>(res);
  if (!r.ok) error(r.failure.status, r.failure.message);
  const users = res.data?.success ? res.data.data : [];
  return {
    users,
    state: { ...st, sort, total: r.data.meta.total, totalPages: r.data.meta.totalPages },
  };
};

export const actions: Actions = {
  /** Bulk action (L-16): deactivate the selected users — one PUT each, through the same API guard. */
  deactivate: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    const ids = form.getAll('ids').filter((v): v is string => typeof v === 'string');
    const client = apiFor(event);
    let done = 0;
    for (const id of ids) {
      const r = unwrap(await client.v1.users({ id }).put({ statusId: 0 }));
      if (r.ok) done++;
      else if (r.failure.status === 403) return actionFailure(r.failure);
    }
    redirect(
      303,
      `${event.url.pathname}${event.url.search}${event.url.search ? '&' : '?'}deactivated=${done}`,
    );
  },
};
