import { LOCALES } from '@core/i18n';
import { themes } from '@core/ui-theme';
import { api } from '$lib/api/client';
import { isSignupEnabled } from '$lib/server/config';
import { shareImage } from '$lib/server/seo';
import type { PageServerLoad } from './$types';

/**
 * The built-in landing page (F-6): what `/` serves — signed in or not — when no landing route is
 * configured, when the configured one points at `/` itself, or when it cannot be rendered (module
 * disabled, route gone). Server-side load → typed API call → HTML with the data already in it
 * (Decision B). Everything it shows is generic — the core never names a module (§4.4): the module
 * list, the build identity and the dialect all come from `GET /v1/version`. The list is narrowed
 * to the modules enabled for the tenant this visitor lands on (G-8): a module switched off is not
 * part of "this installation" as far as the front door is concerned. When the enabled state could
 * not be read, `enabledModules` already holds every module, so nothing is hidden by accident.
 */
export const load: PageServerLoad = async (event) => {
  const { locals, url } = event;
  const [{ data, error }, share] = await Promise.all([
    api(locals.requestId).v1.version.get(),
    shareImage(event),
  ]);
  const api_ = data?.success
    ? {
        ...data.data,
        modules: data.data.modules.filter((m) => locals.config.enabledModules.has(m.ns)),
      }
    : null;
  return {
    requestId: locals.requestId,
    api: api_,
    apiError: error ? `${error.status}` : null,
    signupEnabled: isSignupEnabled(locals.config),
    origin: url.origin,
    /** og:image: Settings → Application → Default share image, else the shipped file. */
    share,
    /** Facts for the hero figures — counted here so the page never imports a registry itself. */
    localeCount: LOCALES.length,
    themeCount: themes().filter((t) => t.module === 'core').length,
  };
};
