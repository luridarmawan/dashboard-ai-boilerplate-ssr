import { actionFailure, apiFor, checkCsrf, csrfToken, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Password reset request (A-7). The answer is uniform whether or not the email exists. */
export const load: PageServerLoad = async (event) => ({ csrf: csrfToken(event) });

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const values = { email: str(form, 'email') };
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
    const r = unwrap(await apiFor(event).v1.auth['reset-password'].request.post(values));
    if (!r.ok) return actionFailure(r.failure, values);
    return { sent: true, values };
  },
};
