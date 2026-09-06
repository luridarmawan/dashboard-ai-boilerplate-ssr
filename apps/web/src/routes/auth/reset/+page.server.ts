import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, csrfToken, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Set a new password with a one-time token (A-7). The token is validated before the form shows. */
export const load: PageServerLoad = async (event) => {
  const token = event.url.searchParams.get('token') ?? '';
  const r = token
    ? unwrap(await apiFor(event).v1.auth['reset-password']['validate-token'].post({ token }))
    : null;
  const valid = r?.ok ? (r.data as unknown as { data: { valid: boolean } }).data.valid : false;
  return { csrf: csrfToken(event), token, valid };
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    }
    const r = unwrap(
      await apiFor(event).v1.auth['reset-password'].confirm.post({
        token: str(form, 'token'),
        password: str(form, 'password'),
      }),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/auth/login?reset=1');
  },
};
