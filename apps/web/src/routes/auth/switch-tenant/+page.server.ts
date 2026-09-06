import { redirect } from '@sveltejs/kit';
import { apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  redirect(303, '/dashboard');
};

/** Switching tenant is a real navigation, not client state (B-4): POST, then reload the page. */
export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const back = str(form, 'back');
    const target = back.startsWith('/') && !back.startsWith('//') ? back : '/dashboard';
    if (!event.locals.session || !checkCsrf(event, form)) redirect(303, target);
    const r = unwrap(
      await apiFor(event).v1.auth['switch-tenant'].post({ clientId: str(form, 'clientId') }),
    );
    redirect(303, r.ok ? target : `${target}${target.includes('?') ? '&' : '?'}tenant_error=1`);
  },
};
