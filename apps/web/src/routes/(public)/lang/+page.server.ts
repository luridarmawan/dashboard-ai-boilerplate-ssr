import { isLocale, LOCALES } from '@core/i18n';
import { redirect } from '@sveltejs/kit';
import { rememberLocale } from '$lib/server/locale';
import { apiFor, checkCsrf, csrfToken, str } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Language picker (K-7): anonymous or logged in, no JavaScript — form → cookie (+ profile) → redirect. */
export const load: PageServerLoad = async (event) => {
  const back = event.url.searchParams.get('back');
  return {
    csrf: csrfToken(event),
    current: event.locals.locale.locale,
    source: event.locals.locale.source,
    locales: [...LOCALES],
    back: back?.startsWith('/') && !back.startsWith('//') ? back : null,
  };
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const back = str(form, 'back');
    const target = back.startsWith('/') && !back.startsWith('//') ? back : '/lang';
    if (!checkCsrf(event, form)) redirect(303, target);
    const lang = str(form, 'lang');
    if (isLocale(lang)) {
      rememberLocale(event, lang);
      if (event.locals.session && event.locals.session.user.locale !== lang) {
        await apiFor(event)
          .v1.users.profile.me.put({ locale: lang })
          .catch(() => undefined);
      }
    }
    redirect(303, target);
  },
};
