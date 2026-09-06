import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const res = await apiFor(event).v1.clients({ id: event.params.id }).get();
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, 'Tenant tidak ditemukan');
  return { client: res.data.data };
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
    const r = unwrap(
      await apiFor(event)
        .v1.clients({ id: event.params.id })
        .put({
          name: str(form, 'name'),
          statusId: form.get('active') === 'on' ? 1 : 0,
        }),
    );
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
    const r = unwrap(await apiFor(event).v1.clients({ id: event.params.id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/tenants');
  },
};
