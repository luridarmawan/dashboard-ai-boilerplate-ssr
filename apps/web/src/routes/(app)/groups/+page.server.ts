import { createTranslator } from '@core/i18n';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const res = await apiFor(event).v1.groups.get({ query: { limit: 100, sort: 'name' } });
  if (!res.data?.success) error(res.status, t('groups.load_failed'));
  return { groups: res.data.data };
};
