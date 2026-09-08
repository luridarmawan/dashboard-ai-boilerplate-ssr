import { messagesFor } from '@core/i18n';
import type { LayoutServerLoad } from './$types';

/** Root data every page gets: active theme (for `<Icon>`) and the active locale's messages (K-2). */
/** Only absolute paths/URLs are usable as <img src>: file themes' `./logo.svg` placeholders are not. */
const usableAsset = (v: string | undefined) =>
  v && (v.startsWith('/') || /^https?:\/\//.test(v)) ? v : null;

export const load: LayoutServerLoad = async ({ locals }) => ({
  theme: {
    id: locals.theme.theme.id,
    iconSet: locals.theme.theme.icons,
    mode: locals.theme.mode,
    source: locals.theme.source,
    /** Brand logo of the active theme (L-24 + Q-16), when it has one. */
    logoUrl: usableAsset(locals.theme.theme.assets?.logo),
    faviconUrl: usableAsset(locals.theme.theme.assets?.favicon),
  },
  locale: locals.locale.locale,
  dir: locals.dir,
  messages: messagesFor(locals.locale.locale),
});
