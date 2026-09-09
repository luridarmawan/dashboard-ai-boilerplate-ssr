import { createTranslator, type Locale } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/**
 * One group: rename, the permission matrix (registry resources × actions, C-4), members.
 * Each block is its own form + named action, so every step works without JavaScript.
 */
export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const client = apiFor(event);
  const [group, registry, users] = await Promise.all([
    client.v1.groups({ id: event.params.id }).get(),
    client.v1.auth['permission-registry'].get(),
    client.v1.users.get({ query: { limit: 100, sort: 'name' } }),
  ]);
  if (!group.data?.success)
    error(group.status === 404 ? 404 : group.status, t('groups.detail.not_found'));
  return {
    group: group.data.data,
    registry: registry.data?.success ? registry.data.data.resources : [],
    tenantUsers: users.data?.success ? users.data.data : [],
    /**
     * Deleting a group takes its members' permissions with it, so it takes two steps:
     * `?confirm=delete` opens the confirmation — a plain link, no JavaScript needed (L-22) — and
     * the action below still refuses a POST whose typed code does not match.
     */
    confirmDelete: event.url.searchParams.get('confirm') === 'delete',
  };
};

const csrfFail = (locale: Locale) =>
  actionFailure({
    status: 403,
    code: 'csrf_failed',
    message: createTranslator(locale)('common.form_expired'),
  });

export const actions: Actions = {
  save: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(
      await apiFor(event)
        .v1.groups({ id: event.params.id })
        .put({
          name: str(form, 'name'),
          description: str(form, 'description') || null,
        }),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'group' as const };
  },
  permissions: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const checked = form.getAll('perm').filter((p): p is string => typeof p === 'string');
    const extra = str(form, 'extra')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const r = unwrap(
      await apiFor(event)
        .v1['group-permissions']({ id: event.params.id })
        .put({
          permissions: [...checked, ...extra],
        }),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'permissions' as const };
  },
  addMember: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(
      await apiFor(event)
        .v1['group-members']({ id: event.params.id })
        .post({ userId: str(form, 'userId') }),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'members' as const };
  },
  removeMember: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(
      await apiFor(event)
        .v1['group-members']({ id: event.params.id })({ userId: str(form, 'userId') })
        .delete(),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'members' as const };
  },
  delete: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    // The confirmation is enforced HERE, not only in the markup: the caller must type the group's own
    // code, read back from the API rather than from a hidden field a client could edit.
    const current = await apiFor(event).v1.groups({ id: event.params.id }).get();
    if (!current.data?.success)
      error(current.status === 404 ? 404 : current.status, t('groups.detail.not_found'));
    if (str(form, 'code').trim() !== current.data.data.code)
      return actionFailure({
        status: 422,
        code: 'confirm_failed',
        message: t('groups.detail.delete_confirm_mismatch'),
      });
    const r = unwrap(await apiFor(event).v1.groups({ id: event.params.id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/groups');
  },
};
