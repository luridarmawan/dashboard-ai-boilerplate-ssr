import { formToObject, UserCreateBody, validateForm } from '@core/contracts';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const groups = await apiFor(event).v1.groups.get({ query: { limit: 100 } });
  if (!groups.data?.success) error(groups.status, 'Grup tidak bisa dimuat');
  return { groups: groups.data.data };
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const input = formToObject(form, { arrays: ['groupIds'] });
    if (!checkCsrf(event, form)) {
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
        },
        input,
      );
    }
    // The SAME schema the API enforces (L-17): field errors render next to the field, no JS needed.
    const v = validateForm(UserCreateBody, input);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: 'Periksa isian yang ditandai',
          details: v.errors,
        },
        input,
      );
    const res = await apiFor(event).v1.users.post(v.value);
    const r = unwrap<{ success: true; data: { id: string } }>(res);
    if (!r.ok) return actionFailure(r.failure, input);
    redirect(303, `/users/${r.data.data.id}?created=1`);
  },
};
