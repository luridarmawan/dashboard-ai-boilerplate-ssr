import { createTranslator } from '@core/i18n';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';
import type { PageServerLoad } from './$types';

/** Outgoing webhooks of the active tenant (J-5). */
export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const res = await apiFor(event).v1.webhooks.get();
  if (!res.data?.success)
    error(res.status, res.status === 403 ? t('webhooks.forbidden') : t('webhooks.load_failed'));
  return { webhooks: res.data.data, saved: event.url.searchParams.get('saved') };
};
