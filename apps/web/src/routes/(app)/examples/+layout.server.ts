import { createTranslator } from '@core/i18n';
import { error } from '@sveltejs/kit';
import { examplePagesEnabled } from '$lib/server/config';
import type { LayoutServerLoad } from './$types';

/**
 * The page-pattern gallery (L-19) belongs to the boilerplate, not to every deployment built from
 * it. EXAMPLE_PAGE_ENABLE=false makes every page under `/examples` answer 404 — exactly what a
 * visitor would see if it had never been built — while the sidebar entry and the `route` settings
 * drop it too, so nothing links anywhere dead.
 */
export const load: LayoutServerLoad = (event) => {
  if (!examplePagesEnabled())
    error(404, createTranslator(event.locals.locale.locale)('error.app.not_found'));
};
