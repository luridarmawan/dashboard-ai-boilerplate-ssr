import { createTranslator } from '@core/i18n';
import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

/** Provider profiles of the active tenant (H-10). */
export const _layoutVariant = 'wide';

export const load: ServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const res = await apiFor(event).v1.m.ai.providers.get();
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? t('ai.providers.forbidden') : t('ai.providers.load_failed'),
    );
  return { providers: res.data.data, saved: event.url.searchParams.get('saved') };
};
