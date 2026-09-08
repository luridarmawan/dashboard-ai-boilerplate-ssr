import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import { previewsFor } from './_editor.server.ts';
import { valuesOf } from './_editor.ts';
import type { Actions, PageServerLoad } from './$types';

/** Custom themes of the active tenant (or global with ?scope=global, superadmin) — PRD L-24. */
export const _layoutVariant = 'wide';

export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const scope = event.url.searchParams.get('scope') === 'global' ? 'global' : 'tenant';
  const res = await apiFor(event).v1.themes.custom.mine.get({
    query: scope === 'global' ? { scope: 'global' } : {},
  });
  if (!res.data?.success)
    error(res.status, res.status === 403 ? t('themes.error_forbidden') : t('themes.error_load'));
  const previews: Record<string, { light: string; dark: string }> = {};
  for (const t of res.data.data.themes) previews[t.id] = previewsFor(valuesOf(t));
  return {
    scope,
    canGlobal: !!event.locals.session?.user.isSuperadmin,
    themes: res.data.data.themes,
    previews,
    bases: res.data.data.bases,
    defaultTheme: String(event.locals.config.values['app.default_theme'] ?? 'base'),
    saved: event.url.searchParams.get('saved'),
  };
};

export const actions: Actions = {
  /** Make a custom theme the tenant (or global) default — same endpoint the settings page uses. */
  setDefault: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure({ status: 403, code: 'csrf_failed', message: t('common.form_expired') });
    const scope = str(form, 'scope') === 'global' ? ('global' as const) : ('tenant' as const);
    const r = unwrap(
      await apiFor(event).v1.themes.default.put({ theme: str(form, 'theme'), scope }),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, `/themes?saved=default${scope === 'global' ? '&scope=global' : ''}`);
  },
};
