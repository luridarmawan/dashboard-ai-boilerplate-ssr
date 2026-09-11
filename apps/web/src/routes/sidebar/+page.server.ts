import { redirect } from '@sveltejs/kit';
import { apiFor, checkCsrf, str } from '$lib/server/session';
import { rememberSidebar, type SidebarState } from '$lib/server/sidebar';
import type { Actions, PageServerLoad } from './$types';

/**
 * Sidebar rail toggle (F-8). There is no page here: the shell posts a form, the server writes
 * the cookie AND the profile, then redirects back — the next render already has the new state
 * on <html>, so collapsing works with JavaScript disabled (L-22). With JavaScript the same form
 * is enhanced (see SidebarToggle.svelte) and nothing reloads.
 */
export const load: PageServerLoad = async () => {
  redirect(303, '/dashboard');
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const back = str(form, 'back');
    const target = back.startsWith('/') && !back.startsWith('//') ? back : '/dashboard';
    if (!checkCsrf(event, form)) redirect(303, target);

    const state: SidebarState = str(form, 'state') === 'collapsed' ? 'collapsed' : 'expanded';
    rememberSidebar(event, state);
    // Logged in: the choice follows the user across devices (D-4), like the theme. A failure is
    // not fatal — the cookie already carries it for this browser.
    const user = event.locals.session?.user;
    if (user && user.sidebarCollapsed !== (state === 'collapsed')) {
      await apiFor(event)
        .v1.users.profile.me.put({ sidebarCollapsed: state === 'collapsed' })
        .catch(() => undefined);
    }
    redirect(303, target);
  },
};
