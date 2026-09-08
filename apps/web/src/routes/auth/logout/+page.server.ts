import { redirect } from '@sveltejs/kit';
import {
  apiFor,
  checkCsrf,
  forwardSetCookies,
  IMPERSONATE_COOKIE,
  SESSION_COOKIE,
} from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  redirect(303, '/'); // logout is a POST (A-5, A-10) — a GET just goes home
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    if (checkCsrf(event, form)) {
      const res = await apiFor(event).v1.auth.logout.post();
      forwardSetCookies(event, res.response);
    }
    event.cookies.delete(SESSION_COOKIE, { path: '/' });
    event.cookies.delete(IMPERSONATE_COOKIE, { path: '/' });
    redirect(303, '/auth/login');
  },
};
