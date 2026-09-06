import { moduleWidgets } from '$lib/../generated/widgets';
import type { PageServerLoad } from './$types';

/**
 * Dashboard home (G-19): widgets contributed by modules, FILTERED by the user's permissions on
 * the server. A widget the user may not see is not in the HTML and its component is never
 * downloaded — the same rule as the menu (F-1, F-2). Order and size are metadata from the module.
 */
export const load: PageServerLoad = async (event) => {
  const s = event.locals.session;
  const locale = event.locals.locale.locale;
  const allowed = moduleWidgets
    .filter((w) => !w.permission || (s?.can(w.permission) ?? false))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return {
    widgets: allowed.map((w) => ({
      id: w.id,
      title: w.title[locale] ?? w.title.id,
      module: w.module,
      size: w.size ?? 'sm',
    })),
  };
};
