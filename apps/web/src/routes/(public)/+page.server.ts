import { LOCALES } from '@core/i18n';
import { themes } from '@core/ui-theme';
import { redirect } from '@sveltejs/kit';
import { api } from '$lib/api/client';
import { cfgString, isSignupEnabled } from '$lib/server/config';
import type { PageServerLoad } from './$types';

/**
 * The built-in landing page (F-6): what `/` serves to an anonymous visitor when no landing route is
 * configured, when the configured one points at `/` itself, or when it cannot be rendered (module
 * disabled, route gone). Server-side load → typed API call → HTML with the data already in it
 * (Decision B). Everything it shows is generic — the core never names a module (§4.4): the module
 * list, the build identity and the dialect all come from `GET /v1/version`.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.session) redirect(303, cfgString(locals.config, 'app.home_route', '/dashboard'));
  const { data, error } = await api(locals.requestId).v1.version.get();
  return {
    requestId: locals.requestId,
    api: data?.success ? data.data : null,
    apiError: error ? `${error.status}` : null,
    signupEnabled: isSignupEnabled(locals.config),
    origin: url.origin,
    /** Facts for the hero figures — counted here so the page never imports a registry itself. */
    localeCount: LOCALES.length,
    themeCount: themes().filter((t) => t.module === 'core').length,
  };
};
