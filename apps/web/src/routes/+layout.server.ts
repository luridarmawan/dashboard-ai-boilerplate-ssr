import { messagesFor } from '@core/i18n';
import type { LayoutServerLoad } from './$types';

/** Root data every page gets: active theme (for `<Icon>`) and the active locale's messages (K-2). */
export const load: LayoutServerLoad = async ({ locals }) => ({
  theme: {
    id: locals.theme.theme.id,
    iconSet: locals.theme.theme.icons,
    mode: locals.theme.mode,
    source: locals.theme.source,
  },
  locale: locals.locale.locale,
  messages: messagesFor(locals.locale.locale),
});
