import { redirect } from '@sveltejs/kit';
import { cfgBool } from '$lib/server/config';
import {
  actionFailure,
  apiFor,
  checkCsrf,
  csrfToken,
  forwardSetCookies,
  str,
  unwrap,
} from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Self-registration (A-1). The API decides whether it is open (SIGNUP_ENABLED). */
export const load: PageServerLoad = async (event) => {
  if (event.locals.session) redirect(303, '/dashboard');
  return {
    csrf: csrfToken(event),
    signupEnabled: cfgBool(event.locals.config, 'security.signup_enabled'),
  };
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
    const res = await apiFor(event).v1.auth.register.post({
      ...values,
      password: str(form, 'password'),
    });
    const r = unwrap(res);
    if (!r.ok) return actionFailure(r.failure, values);
    forwardSetCookies(event, res.response);
    redirect(303, '/dashboard');
  },
};
