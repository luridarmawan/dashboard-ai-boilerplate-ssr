import { error, redirect } from '@sveltejs/kit';
import { cfgBool, isSignupEnabled } from '$lib/server/config';
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

/** Self-registration (A-1). Closed with 404 when SIGNUP_ENABLED=false (flag only for self-service; /join stays open). */
export const load: PageServerLoad = async (event) => {
  if (event.locals.session) redirect(303, '/dashboard');
  if (!isSignupEnabled(event.locals.config)) error(404, 'New registration disabled');
  return {
    csrf: csrfToken(event),
    signupEnabled: cfgBool(event.locals.config, 'security.signup_enabled'),
  };
};

export const actions: Actions = {
  default: async (event) => {
    if (!isSignupEnabled(event.locals.config)) {
      return actionFailure(
        { status: 403, code: 'signup_disabled', message: 'New registration disabled' },
        {},
      );
    }
    const form = await event.request.formData();
    const values = { email: str(form, 'email'), name: str(form, 'name') };
    if (!checkCsrf(event, form)) {
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: 'Expired session — please refresh',
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
