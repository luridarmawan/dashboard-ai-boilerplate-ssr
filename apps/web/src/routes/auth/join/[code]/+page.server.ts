import { createTranslator } from '@core/i18n';
import { redirect } from '@sveltejs/kit';
import { cfgString } from '$lib/server/config';
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

/**
 * Registration by invitation (A-13): the page shows whom the code is for, the form asks only for a
 * name and a password (typed twice), and the API opens the session — with SIGNUP_ENABLED off too.
 * Works without JavaScript; the show/hide toggle on the password fields is the only enhancement.
 */
export const load: PageServerLoad = async (event) => {
  const home = cfgString(event.locals.config, 'app.home_route', '/dashboard');
  if (event.locals.session) redirect(303, home);
  const r = unwrap<{
    success: true;
    data: { email: string; tenant: { id: string; name: string }; expiresAt: string };
  }>(await apiFor(event).v1.auth.join({ code: event.params.code }).get());
  return {
    csrf: csrfToken(event),
    code: event.params.code,
    invitation: r.ok ? r.data.data : null,
    problem: r.ok ? null : r.failure.code,
  };
};

export const actions: Actions = {
  default: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const values = { name: str(form, 'name') };
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        values,
      );
    // Same check as the password change on /profile: the API never sees the confirmation field.
    if (str(form, 'password') !== str(form, 'password_confirm'))
      return actionFailure(
        { status: 422, code: 'password_mismatch', message: t('join.password_mismatch') },
        values,
      );
    const res = await apiFor(event).v1.auth.join.post({
      code: event.params.code,
      name: values.name,
      password: str(form, 'password'),
    });
    const r = unwrap(res);
    if (!r.ok) return actionFailure(r.failure, values);
    forwardSetCookies(event, res.response);
    redirect(303, cfgString(event.locals.config, 'app.home_route', '/dashboard'));
  },
};
