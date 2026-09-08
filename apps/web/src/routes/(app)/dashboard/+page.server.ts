import { moduleWidgets } from '$lib/../generated/widgets';
import { apiFetchData } from '$lib/server/session';
import type { PageServerLoad } from './$types';

/**
 * Dashboard home (G-19): widgets contributed by modules, FILTERED by the user's permissions on
 * the server. A widget the user may not see is not in the HTML and its component is never
 * downloaded — the same rule as the menu (F-1, F-2). Order and size are metadata from the module.
 * A widget with a `data` path gets that API response (fetched here, as this user) as its `data` prop.
 */
export const load: PageServerLoad = async (event) => {
  const s = event.locals.session;
  const locale = event.locals.locale.locale;
  const allowed = moduleWidgets
    .filter((w) => event.locals.config.enabledModules.has(w.module.toLowerCase()))
    .filter((w) => !w.permission || (s?.can(w.permission) ?? false))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const widgets = await Promise.all(
    allowed.map(async (w) => ({
      id: w.id,
      title: w.title[locale] ?? w.title.id,
      module: w.module,
      size: w.size ?? 'sm',
      data: w.data ? await apiFetchData(event, w.data, event.locals.session?.clientId) : null,
    })),
  );
  return { widgets };
};
