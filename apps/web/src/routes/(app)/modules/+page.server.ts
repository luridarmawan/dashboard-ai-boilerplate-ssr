import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Installed modules and their state for the active tenant (G-8). */
export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const res = await apiFor(event).v1.module.get();
  if (!res.data?.success)
    error(res.status, res.status === 403 ? t('modules.error_forbidden') : t('modules.error_load'));
  // G-16: the catalog needs module.manage; anyone else simply gets no catalog section.
  const cat = await apiFor(event)
    .v1.module.catalog.get()
    .then((r) => (r.data?.success ? r.data.data : null))
    .catch(() => null);
  return {
    modules: res.data.data,
    catalog: cat,
    canGlobal: !!event.locals.session?.user.isSuperadmin,
  };
};

export const actions: Actions = {
  toggle: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure({ status: 403, code: 'csrf_failed', message: t('common.form_expired') });
    const state = str(form, 'state'); // on | off | inherit
    const scope = str(form, 'scope') === 'global' ? 'global' : 'tenant';
    const r = unwrap(
      await apiFor(event)
        .v1.module({ id: str(form, 'module') })
        .enabled.put({
          enabled: state === 'inherit' ? null : state === 'on',
          ...(scope === 'global' ? { scope: 'global' as const } : {}),
        }),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/modules');
  },
};
