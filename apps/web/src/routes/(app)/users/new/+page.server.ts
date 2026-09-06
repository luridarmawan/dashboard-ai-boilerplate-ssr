import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, optStr, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const groups = await apiFor(event).v1.groups.get({ query: { limit: 100 } });
  if (!groups.data?.success) error(groups.status, 'Grup tidak bisa dimuat');
  return { groups: groups.data.data };
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const values = { email: str(form, 'email'), name: str(form, 'name') };
    if (!checkCsrf(event, form)) {
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
        },
        values,
      );
    }
    const groupIds = form.getAll('groupIds').filter((g): g is string => typeof g === 'string');
    const res = await apiFor(event).v1.users.post({
      ...values,
      ...(optStr(form, 'password') ? { password: str(form, 'password') } : {}),
      groupIds,
    });
    const r = unwrap<{ success: true; data: { id: string } }>(res);
    if (!r.ok) return actionFailure(r.failure, values);
    redirect(303, `/users/${r.data.data.id}?created=1`);
  },
};
