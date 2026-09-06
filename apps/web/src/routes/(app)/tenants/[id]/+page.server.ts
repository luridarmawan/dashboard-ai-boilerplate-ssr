import { ClientUpdateBody, formToObject, validateForm } from '@core/contracts';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
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
    const raw = formToObject(form);
    const v = validateForm(ClientUpdateBody, {
      name: raw.name,
      statusId: raw.active !== undefined ? 1 : 0,
    });
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: 'Periksa isian yang ditandai',
          details: v.errors,
        },
        raw,
      );
    const r = unwrap(await apiFor(event).v1.clients({ id: event.params.id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
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
