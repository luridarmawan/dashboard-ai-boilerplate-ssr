import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const values = { code: str(form, 'code'), name: str(form, 'name') };
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
    const r = unwrap<{ success: true; data: { id: string } }>(
      await apiFor(event).v1.clients.post(values),
    );
    if (!r.ok) return actionFailure(r.failure, values);
    redirect(303, `/tenants/${r.data.data.id}`);
  },
};
