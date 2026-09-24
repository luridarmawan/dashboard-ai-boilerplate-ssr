import { createTranslator } from '@core/i18n';
import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, csrfToken, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/**
 * Set a new password with a one-time token (A-7). The token is validated before the form shows.
 * The password is typed twice; works without JavaScript, the show/hide toggle is the only
 * enhancement.
 */
export const load: PageServerLoad = async (event) => {
  const token = event.url.searchParams.get('token') ?? '';
  // The token check is a POST, and the API wants its double-submit pair on every POST: mint the
  // CSRF cookie FIRST so a fresh browser (the e-mail link is usually its first visit) has one to
  // forward. Minting it after the call made every first visit read "invalid link".
  const csrf = csrfToken(event);
  const r = token
    ? unwrap(await apiFor(event).v1.auth['reset-password']['validate-token'].post({ token }))
    : null;
  const valid = r?.ok ? (r.data as unknown as { data: { valid: boolean } }).data.valid : false;
  return { csrf, token, valid };
};

export const actions: Actions = {
  default: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    }
    // Same check as on /auth/join and /profile: the API never sees the confirmation field.
    if (str(form, 'password') !== str(form, 'password_confirm'))
      return actionFailure({
        status: 422,
        code: 'password_mismatch',
        message: t('auth.reset.mismatch'),
      });
    const r = unwrap(
      await apiFor(event).v1.auth['reset-password'].confirm.post({
        token: str(form, 'token'),
        password: str(form, 'password'),
      }),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/auth/login?reset=1');
  },
};
