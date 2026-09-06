import { formToObject, GroupCreateBody, validateForm } from '@core/contracts';
import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const input = formToObject(form, { nullable: ['description'] });
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
    const v = validateForm(GroupCreateBody, input);
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
    const res = await apiFor(event).v1.groups.post(v.value);
    const r = unwrap<{ success: true; data: { id: string } }>(res);
    if (!r.ok) return actionFailure(r.failure, input);
    redirect(303, `/groups/${r.data.data.id}`);
  },
};
