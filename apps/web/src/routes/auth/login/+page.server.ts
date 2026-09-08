import { redirect } from '@sveltejs/kit';
import { cfgBool, cfgString } from '$lib/server/config';
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
  return {
    csrf: csrfToken(event),
    next: safeNext(event.url.searchParams.get('next'), home),
    // Sign in with Google (A-8) is a link to /auth/google; shown only when an admin switched it on.
    google: cfgBool(event.locals.config, 'security.google_enabled') === true,
    // /auth/google bounces here with ?error= when the provider is off or the API refused to start.
    ssoError: event.url.searchParams.get('error'),
  };
};

function safeNext(next: string | null, home = '/dashboard'): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : home;
}

export const actions: Actions = {
  /**
   * One default action for both steps (SvelteKit forbids mixing `default` with named actions, and
   * every proof/E2E posts to /auth/login without a suffix): a `challenge` field means step two.
   */
  default: async (event) => {
    const form = await event.request.formData();
    if (str(form, 'challenge')) return mfaStep(event, form);
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
    const r = unwrap<{
      success: true;
      data: { mfaRequired?: true; challenge?: string; user?: unknown };
    }>(res);
    if (!r.ok) return actionFailure(r.failure, values);
    // Second factor (A-11): render the code form; the challenge token rides along as a hidden field.
    if (r.data.data.mfaRequired && r.data.data.challenge)
      return { mfa: { challenge: r.data.data.challenge, next: str(form, 'next') }, values };
    forwardSetCookies(event, res.response);
    redirect(
      303,
      safeNext(str(form, 'next'), cfgString(event.locals.config, 'app.home_route', '/dashboard')),
    );
  },
};

/** Step two (A-11): TOTP or recovery code against the challenge from step one. */
async function mfaStep(event: Parameters<NonNullable<Actions['default']>>[0], form: FormData) {
  const challenge = str(form, 'challenge');
  const next = str(form, 'next');
  if (!checkCsrf(event, form))
    return actionFailure({
      status: 403,
      code: 'csrf_failed',
      message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
    });
  const res = await apiFor(event).v1.auth.login.mfa.post({ challenge, code: str(form, 'code') });
  const r = unwrap(res);
  if (!r.ok) {
    // A wrong code keeps the same challenge (attempts are counted server-side); an expired or
    // exhausted one sends the user back to the password form.
    const keep = r.failure.status === 401 && /salah/.test(r.failure.message);
    return actionFailure(r.failure, {}, keep ? { mfa: { challenge, next } } : {});
  }
  forwardSetCookies(event, res.response);
  redirect(303, safeNext(next, cfgString(event.locals.config, 'app.home_route', '/dashboard')));
}
