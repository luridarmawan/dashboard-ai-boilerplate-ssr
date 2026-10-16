import { createTranslator } from '@core/i18n';
import { fail } from '@sveltejs/kit';
import { apiFor, checkCsrf, csrfToken, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/**
 * Where the button of a Settings → Email test mail leads. Opening the page records nothing — a
 * link scanner fetches it too — only pressing the button does, through the form below. Works
 * without JavaScript.
 */
export const load: PageServerLoad = async (event) => {
  // The confirmation is a POST, and the API wants its double-submit pair on every POST: mint the
  // CSRF cookie on this first visit (the mail link usually is one).
  return { csrf: csrfToken(event), valid: /^[0-9a-f]{32}$/.test(event.params.token) };
};

export const actions: Actions = {
  default: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return fail(403, { error: t('common.form_expired') });
    const r = unwrap(await apiFor(event).v1.mail.received({ token: event.params.token }).post());
    if (!r.ok) return fail(404, { error: t('auth.mail_received.invalid') });
    return { confirmed: true };
  },
};
