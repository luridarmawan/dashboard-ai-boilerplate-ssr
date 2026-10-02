import { redirect } from '@sveltejs/kit';
import { forgetBrowser } from '$lib/server/forget';
import { apiFor, checkCsrf, forwardSetCookies } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  redirect(303, '/'); // logout is a POST — a GET just goes home
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    if (checkCsrf(event, form)) {
      const res = await apiFor(event).v1.auth.logout.post();
      forwardSetCookies(event, res.response);
    }
    // A deliberate logout leaves nothing behind in the browser: every app cookie — including the
    // cached preferences of the person who just left — and, via Clear-Site-Data, Web Storage.
    forgetBrowser(event);
    redirect(303, '/auth/login');
  },
};
