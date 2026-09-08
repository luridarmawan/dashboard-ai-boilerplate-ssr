import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/**
 * Settings (PRD E-3): the form is GENERATED from the API's section metadata; nothing here knows
 * a field by name. `?scope=global` (superadmin) edits the global fallback, otherwise the active
 * tenant's overrides. Saving posts one section at a time; the API validates by type and bumps
 * the cache version so every instance sees the change at once (E-5).
 */
export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const scope = event.url.searchParams.get('scope') === 'global' ? 'global' : 'tenant';
  const res = await apiFor(event).v1.configuration.get({
    query: scope === 'global' ? { scope: 'global' } : {},
  });
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? t('settings.error_forbidden') : t('settings.error_load'),
    );
  return {
    scope,
    canGlobal: !!event.locals.session?.user.isSuperadmin,
    sections: res.data.data.sections,
    routes: res.data.data.routes,
    saved: event.url.searchParams.get('saved'),
  };
};

export const actions: Actions = {
  save: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({ status: 403, code: 'csrf_failed', message: t('common.form_expired') });
    }
    const scope = str(form, '_scope') === 'global' ? 'global' : 'tenant';
    const section = str(form, '_section');
    const keys = form.getAll('_keys').filter((k): k is string => typeof k === 'string');
    const lists = new Set(form.getAll('_lists').filter((k): k is string => typeof k === 'string'));
    const bools = new Set(form.getAll('_bools').filter((k): k is string => typeof k === 'string'));
    const secrets = new Set(
      form.getAll('_secrets').filter((k): k is string => typeof k === 'string'),
    );
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      if (lists.has(key))
        values[key] = form
          .getAll(key)
          .filter((v): v is string => typeof v === 'string' && v !== '');
      else if (bools.has(key))
        values[key] =
          form.get(`${key}__tri`) === 'inherit' ? '' : form.get(key) === 'on' ? 'true' : 'false';
      else if (secrets.has(key))
        values[key] = form.get(`${key}__clear`) === 'on' ? '__clear__' : str(form, key);
      else values[key] = str(form, key);
    }
    const r = unwrap(
      await apiFor(event).v1.configuration.put({
        ...(scope === 'global' ? { scope: 'global' } : {}),
        values,
      }),
    );
    if (!r.ok) return actionFailure(r.failure, { section });
    redirect(303, `/settings?scope=${scope}&saved=${encodeURIComponent(section)}#${section}`);
  },
};
