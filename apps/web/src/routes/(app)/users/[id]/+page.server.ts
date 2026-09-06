import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const client = apiFor(event);
  const [user, groups] = await Promise.all([
    client.v1.users({ id: event.params.id }).get(),
    client.v1.groups.get({ query: { limit: 100 } }),
  ]);
  if (!user.data?.success)
    error(user.status === 404 ? 404 : user.status, 'Pengguna tidak ditemukan');
  return {
    user: user.data.data,
    groups: groups.data?.success ? groups.data.data : [],
    created: event.url.searchParams.has('created'),
  };
};

export const actions: Actions = {
  save: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    }
    const groupIds = form.getAll('groupIds').filter((g): g is string => typeof g === 'string');
    const body: {
      name: string;
      statusId: 0 | 1;
      groupIds: string[];
      isSuperadmin?: boolean;
    } = {
      name: str(form, 'name'),
      statusId: form.get('active') === 'on' ? 1 : 0,
      groupIds,
    };
    if (event.locals.session?.user.isSuperadmin)
      body.isSuperadmin = form.get('isSuperadmin') === 'on';
    const r = unwrap(await apiFor(event).v1.users({ id: event.params.id }).put(body));
    if (!r.ok) return actionFailure(r.failure);
    return { saved: true };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    }
    const r = unwrap(await apiFor(event).v1.users({ id: event.params.id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/users');
  },
};
