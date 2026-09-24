import { createTranslator } from '@core/i18n';
import { error, fail, redirect } from '@sveltejs/kit';
import { tableStateFrom } from '$lib/components/table';
import {
  type ApiFailure,
  actionFailure,
  apiFor,
  checkCsrf,
  confirmed,
  csrfToken,
  forwardSetCookies,
  str,
  unwrap,
} from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/**
 * A wide table: ask the theme for its `wide` layout (Decision K). The page never names a layout id.
 * SvelteKit only allows custom page-module exports with a `_` prefix, hence `_layoutVariant`.
 */
export const _layoutVariant = 'wide';

const SORTABLE = new Set(['name', 'email', 'created_at', 'last_login_at', 'last_active_at']);

/**
 * Users of the active tenant (D-1). The URL is the table state; `load` fetches, DataTable renders.
 * `group` is the one page-specific filter: a group id of this tenant, narrowing to its members.
 */
export const load: PageServerLoad = async (event) => {
  const st = tableStateFrom(event.url, { sort: 'name', extra: ['group'] });
  const sort = SORTABLE.has(st.sort) ? st.sort : 'name';
  const group = st.extra?.group;
  const res = await apiFor(event).v1.users.get({
    query: {
      ...(st.q ? { q: st.q } : {}),
      ...(group ? { group } : {}),
      page: st.page,
      limit: st.limit,
      sort,
      order: st.order,
    },
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
  // The group filter's options, and the group picker of the invite card: needs group.read —
  // without it neither is offered (the filter itself still applies from the URL; a group id is not
  // a secret, and an invitation without a picked group lands in the API's default, Regular User).
  const grp = await apiFor(event).v1.groups.get({ query: { limit: 100, sort: 'name' } });
  const groups = grp.data?.success
    ? grp.data.data.map((g: { id: string; code: string; name: string }) => ({
        id: g.id,
        code: g.code,
        name: g.name,
      }))
    : null;
  return {
    users,
    invitations,
    groups,
    csrf: csrfToken(event),
    state: { ...st, sort, total: r.data.meta.total, totalPages: r.data.meta.totalPages },
  };
};

/**
 * `actionFailure` with the action stamped on it: this page has four actions and one `form` prop,
 * so a refused impersonation has to say so — otherwise the invite card below claims the message.
 */
const impersonateFailure = (f: ApiFailure) =>
  fail(f.status >= 400 && f.status < 600 ? f.status : 500, {
    error: f.message,
    code: f.code,
    impersonate: true,
  });

export const actions: Actions = {
  /**
   * Impersonate (D-6) straight from the list — the same call the user detail page makes. The API
   * is the guard: superadmin only, never yourself, another superadmin, or a deactivated user.
   */
  impersonate: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return impersonateFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    const res = await apiFor(event)
      .v1.users({ id: str(form, 'id') })
      .impersonate.post();
    const r = unwrap(res);
    if (!r.ok) return impersonateFailure(r.failure);
    forwardSetCookies(event, res.response);
    redirect(303, '/dashboard');
  },
  /**
   * Invite an e-mail into the active tenant (A-13); the link comes back once for hand-over.
   * `groupId` is the group the invitee joins: the picker's value, `''` for "no group" (sent as
   * null), and no field at all (the picker is hidden without group.read) leaves the API's default.
   *
   * Two POSTs (L-22), like `deactivate`: the first carries the address and group but no `confirm`
   * token and only earns the question — the page asks inline (or already asked in a modal and
   * posts the second step straight away). Nothing is sent until `?confirm=invite` arrives.
   */
  invite: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const groupField = form.get('groupId');
    const groupId = typeof groupField === 'string' ? groupField : undefined;
    const values = { email: str(form, 'email').trim(), groupId: groupId ?? '' };
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        values,
      );
    // An empty address is not worth a question: the API refuses it with the usual 422.
    if (values.email && !confirmed(event, 'invite'))
      return { confirmInvite: { email: values.email, groupId }, values };
    const r = unwrap<{
      success: true;
      data: { existing: boolean; email: string; link?: string; expiresAt?: string };
    }>(
      await apiFor(event).v1.invitations.post({
        email: values.email,
        locale: event.locals.locale.locale === 'en' ? 'en' : 'id',
        ...(groupId === undefined ? {} : { groupId: groupId || null }),
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
  /**
   * Bulk action (L-16): deactivate the selected users — one PUT each, through the same API guard.
   * Two POSTs (L-22): the first carries the ticked ids but no `confirm` token and only earns the
   * question — the page renders it inline (or the table already asked in a modal and posts the
   * second step straight away). Nothing changes until `?confirm=deactivate` arrives.
   */
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
    // Nothing ticked: the table already blocks the button, so this only catches a hand-made POST —
    // but it must say so rather than redirect with "0 users deactivated", which reads like success.
    if (ids.length === 0)
      return fail(400, { error: t('table.select_none'), code: 'no_selection', deactivate: true });
    const client = apiFor(event);
    if (!confirmed(event, 'deactivate')) {
      // Name what is about to happen: the POST URL has no `q`/`page`, so the rows may not be in the
      // page that renders the question. One GET each — the confirmed step costs one PUT each anyway.
      const rows = await Promise.all(
        ids.map(async (id) => {
          const r = unwrap<{ success: true; data: { name: string; email: string } }>(
            await client.v1.users({ id }).get(),
          );
          return r.ok
            ? { id, name: r.data.data.name, email: r.data.data.email }
            : { id, name: id, email: '' };
        }),
      );
      return { confirmDeactivate: rows };
    }
    let done = 0;
    for (const id of ids) {
      const r = unwrap(await client.v1.users({ id }).put({ statusId: 0 }));
      if (r.ok) done++;
      else if (r.failure.status === 403) return actionFailure(r.failure);
    }
    // A clean URL: the action's own `?/deactivate&confirm=deactivate` must not survive the redirect.
    redirect(303, `${event.url.pathname}?deactivated=${done}`);
  },
};
