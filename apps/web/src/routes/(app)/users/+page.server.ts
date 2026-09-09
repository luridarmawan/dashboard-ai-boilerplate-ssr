import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { tableStateFrom } from '$lib/components/table';
import { actionFailure, apiFor, checkCsrf, csrfToken, str, unwrap } from '$lib/server/session';
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
  // Pending invitations (A-13): only readable with user.create — a 403 simply hides the section.
  const inv = await apiFor(event).v1.invitations.get();
  const invitations = inv.data?.success ? inv.data.data : null;
  return {
    users,
    invitations,
    csrf: csrfToken(event),
    state: { ...st, sort, total: r.data.meta.total, totalPages: r.data.meta.totalPages },
  };
};

export const actions: Actions = {
  /** Invite an e-mail into the active tenant (A-13); the link comes back once for hand-over. */
  invite: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const values = { email: str(form, 'email') };
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        values,
      );
    const r = unwrap<{
      success: true;
      data: { existing: boolean; email: string; link?: string; expiresAt?: string };
    }>(
      await apiFor(event).v1.invitations.post({
        email: values.email,
        locale: event.locals.locale.locale === 'en' ? 'en' : 'id',
      }),
    );
    if (!r.ok) return actionFailure(r.failure, values);
    const d = r.data.data;
    return d.existing
      ? { invited: { email: d.email, existing: true as const } }
      : {
          invited: {
            email: d.email,
            existing: false as const,
            link: d.link ?? '',
            expiresAt: d.expiresAt ?? '',
          },
        };
  },
  /** Revoke a pending invitation (A-13). */
  revoke: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure({ status: 403, code: 'csrf_failed', message: t('common.form_expired') });
    const r = unwrap(
      await apiFor(event)
        .v1.invitations({ id: str(form, 'id') })
        .delete(),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, `${event.url.pathname}${event.url.search}`);
  },
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
