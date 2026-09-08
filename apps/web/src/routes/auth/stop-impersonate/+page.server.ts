import { redirect } from '@sveltejs/kit';
import { apiFor, checkCsrf, forwardSetCookies, IMPERSONATE_COOKIE, str } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  redirect(303, '/dashboard');
};

/** End impersonation (D-6): the API revokes the impersonated session; the admin's own session stands. */
export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const back = str(form, 'back');
    const target = back.startsWith('/') && !back.startsWith('//') ? back : '/users';
    if (checkCsrf(event, form)) {
      const res = await apiFor(event).v1.users.impersonate.stop.post();
      forwardSetCookies(event, res.response);
    }
    event.cookies.delete(IMPERSONATE_COOKIE, { path: '/' });
    redirect(303, target);
  },
};
