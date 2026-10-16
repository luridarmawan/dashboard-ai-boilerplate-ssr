import { error, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { forgetBrowser } from '$lib/server/forget';
import type { Actions, PageServerLoad } from './$types';

/**
 * Developer-only "clear cache" behind the button on the login page (NODE_ENV=development):
 * expire every cookie this app writes and ask the browser to wipe this origin's Web Storage —
 * the same sweep a deliberate logout performs (A-5), without a session to end.
 *
 * No CSRF check on purpose: the control exists precisely for the moment the CSRF cookie itself
 * is stale, and all it can do is clear the caller's own cookies. Outside development the route
 * does not exist.
 */
const available = () => env.NODE_ENV === 'development';

export const load: PageServerLoad = async () => {
  if (!available()) error(404);
  redirect(303, '/auth/login'); // a GET just goes back to the form
};

export const actions: Actions = {
  default: async (event) => {
    if (!available()) error(404);
    forgetBrowser(event);
    redirect(303, '/auth/login');
  },
};
