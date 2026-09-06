import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/**
 * One group: rename, the permission matrix (registry resources × actions, C-4), members.
 * Each block is its own form + named action, so every step works without JavaScript.
 */
export const load: PageServerLoad = async (event) => {
  const client = apiFor(event);
  const [group, registry, users] = await Promise.all([
    client.v1.groups({ id: event.params.id }).get(),
    client.v1.auth['permission-registry'].get(),
    client.v1.users.get({ query: { limit: 100, sort: 'name' } }),
  ]);
  if (!group.data?.success)
    error(group.status === 404 ? 404 : group.status, 'Grup tidak ditemukan');
  return {
    group: group.data.data,
    registry: registry.data?.success ? registry.data.data.resources : [],
    tenantUsers: users.data?.success ? users.data.data : [],
  };
};

const csrfFail = () =>
  actionFailure({
    status: 403,
    code: 'csrf_failed',
    message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
  });

export const actions: Actions = {
  save: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
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
    if (!checkCsrf(event, form)) return csrfFail();
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
    if (!checkCsrf(event, form)) return csrfFail();
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
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap(
      await apiFor(event)
        .v1['group-members']({ id: event.params.id })({ userId: str(form, 'userId') })
        .delete(),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'members' as const };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap(await apiFor(event).v1.groups({ id: event.params.id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/groups');
  },
};
