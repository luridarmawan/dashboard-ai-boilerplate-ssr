import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const values = {
      code: str(form, 'code'),
      name: str(form, 'name'),
      description: str(form, 'description'),
    };
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
    const res = await apiFor(event).v1.groups.post({
      code: values.code,
      name: values.name,
      description: values.description || null,
    });
    const r = unwrap<{ success: true; data: { id: string } }>(res);
    if (!r.ok) return actionFailure(r.failure, values);
    redirect(303, `/groups/${r.data.data.id}`);
  },
};
