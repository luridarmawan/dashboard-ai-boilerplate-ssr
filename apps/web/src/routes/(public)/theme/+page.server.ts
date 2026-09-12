import { isLocale, LOCALES } from '@core/i18n';
import { isMode, themeById, themes } from '@core/ui-theme';
import { redirect } from '@sveltejs/kit';
import { rememberLocale } from '$lib/server/locale';
import { apiFor, checkCsrf, csrfToken, str } from '$lib/server/session';
import { rememberTheme } from '$lib/server/theme';
import { previewSvg } from '$lib/server/theme-preview';
import type { Actions, PageServerLoad } from './$types';

/**
 * Theme, language & mode picker (PRD L-4, L-11, L-13, K-7): available to anonymous visitors and
 * users alike, shows a preview per theme, and works without JavaScript — a form posts, the server
 * writes the cookies (and the profile, when logged in), then redirects back so the page re-renders
 * with the new theme, icons, layout AND language already applied (L-12).
 */
export const load: PageServerLoad = async (event) => {
  const t = event.locals.theme;
  // L-14: themes of a module disabled for this tenant are not offered.
  const enabled = event.locals.config.enabledModules;
  const custom = event.locals.config.customThemes;
  const list = [...themes(), ...custom.map((c) => c.manifest)]
    .filter((th) => !th.module || th.module === 'core' || enabled.has(th.module.toLowerCase()))
    .filter((th) => !t.allowed || t.allowed.includes(th.id));
  // The bilingual manifest fields follow the language in force for THIS request — the same one
  // `t()` renders with — not only the profile: a visitor who switched language gets it too.
  const locale = event.locals.locale.locale === 'en' ? 'en' : 'id';
  const back = event.url.searchParams.get('back');
  return {
    csrf: csrfToken(event),
    current: t.theme.id,
    source: t.source,
    mode: t.mode,
    locale: event.locals.locale.locale,
    locales: [...LOCALES],
    back: back?.startsWith('/') && !back.startsWith('//') ? back : null,
    themes: list.map((th) => ({
      id: th.id,
      name: th.name[locale],
      description: th.description[locale],
      icons: th.icons,
      layout: th.layouts.dashboard?.default ?? '—',
      preview: previewSvg(
        th,
        t.mode === 'dark' ? 'dark' : 'light',
        custom.find((c) => c.manifest.id === th.id)?.css,
      ),
      custom: th.custom === true,
    })),
  };
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const back = str(form, 'back');
    const target = back.startsWith('/') && !back.startsWith('//') ? back : '/theme';
    if (!checkCsrf(event, form)) redirect(303, target);

    const allowed = event.locals.theme.allowed;
    const wanted = str(form, 'theme');
    const known =
      themeById(wanted) || event.locals.config.customThemes.some((c) => c.manifest.id === wanted);
    const theme = known && (!allowed || allowed.includes(wanted)) ? wanted : null;
    const modeRaw = str(form, 'mode');
    const mode = isMode(modeRaw) ? modeRaw : null;
    rememberTheme(event, theme, mode);

    // K-7: the language rides in the same form, and is remembered the same way /lang does it.
    const langRaw = str(form, 'lang');
    const lang = isLocale(langRaw) ? langRaw : null;
    if (lang) rememberLocale(event, lang);

    // Logged in: the choices follow the user across devices (D-4, L-11, K-2). Failure here is not
    // fatal — the cookies already carry them for this browser.
    const user = event.locals.session?.user;
    const patch = {
      ...(theme && user && user.theme !== theme ? { theme } : {}),
      ...(lang && user && user.locale !== lang ? { locale: lang } : {}),
    };
    if (user && Object.keys(patch).length) {
      await apiFor(event)
        .v1.users.profile.me.put(patch)
        .catch(() => undefined);
    }
    redirect(303, target);
  },
};
