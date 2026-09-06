import type { LayoutServerLoad } from './$types';

/** Root data every page gets: the active theme (id, icon set, mode) for the client-side context. */
export const load: LayoutServerLoad = async ({ locals }) => ({
  theme: {
    id: locals.theme.theme.id,
    iconSet: locals.theme.theme.icons,
    mode: locals.theme.mode,
    source: locals.theme.source,
  },
});
