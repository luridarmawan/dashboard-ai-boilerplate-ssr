import { createTranslator } from '@core/i18n';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** `?code=404|403|500` throws that status so the (app) error page renders inside the shell. */
export const load: PageServerLoad = async ({ url, locals }) => {
  const t = createTranslator(locals.locale.locale);
  const code = Number(url.searchParams.get('code'));
  if (code === 404) error(404, t('examples.errors.msg_404'));
  if (code === 403) error(403, t('examples.errors.msg_403'));
  if (code === 500) error(500, t('examples.errors.msg_500'));
  return {};
};
