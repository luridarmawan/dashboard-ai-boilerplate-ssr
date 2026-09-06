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

/** Login as a plain HTML form (A-2, A-3): works with JavaScript disabled; SSR renders the result. */
export const load: PageServerLoad = async (event) => {
  const home = cfgString(event.locals.config, 'app.home_route', '/dashboard');
  if (event.locals.session) redirect(303, safeNext(event.url.searchParams.get('next'), home));
  return { csrf: csrfToken(event), next: safeNext(event.url.searchParams.get('next'), home) };
};

function safeNext(next: string | null, home = '/dashboard'): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : home;
}

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
    const res = await apiFor(event).v1.auth.login.post({
      email: values.email,
      password: str(form, 'password'),
    });
    const r = unwrap(res);
    if (!r.ok) return actionFailure(r.failure, values);
    forwardSetCookies(event, res.response);
    redirect(
      303,
      safeNext(str(form, 'next'), cfgString(event.locals.config, 'app.home_route', '/dashboard')),
    );
  },
};
