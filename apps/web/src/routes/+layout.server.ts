import { ANONYMOUS_NAMESPACES, messagesFor } from '@core/i18n';
import { modulePublicRoutes } from '$lib/../generated/public-routes';
import { brandedMessages } from '$lib/server/branding';
import { cfgString } from '$lib/server/config';
import type { LayoutServerLoad } from './$types';

/** Modules with public pages: an anonymous visitor may land on one, so their keys travel too. */
const PUBLIC_MODULE_NS = [...new Set(modulePublicRoutes.map((r) => r.ns))];

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
  /**
   * Tenant branding from runtime configuration (E-1, E-2): the application name and logo an
   * admin sets in Pengaturan → Aplikasi, for the brand region of every shell. `app.logo_url` is
   * the tenant's base logo; a custom theme that uploaded its own (L-24) overrides it per theme.
   * The i18n key `app.name` remains the fallback when configuration cannot be read (F-6).
   */
  app: {
    name: cfgString(locals.config, 'app.name', ''),
    logoUrl: usableAsset(cfgString(locals.config, 'app.logo_url', '') || undefined),
  },
  locale: locals.locale.locale,
  dir: locals.dir,
  /**
   * The active locale's catalogue (K-2). Anonymous responses carry only what an anonymous page
   * can render (see ANONYMOUS_NAMESPACES) — the dashboard's ~500 strings would otherwise sit in
   * the HTML of every landing page. Splitting on the SESSION rather than the route is what keeps
   * this correct under client-side navigation: signing in and out are full document loads, while
   * a client navigation can never change the session, so the catalogue can never be stale.
   */
  messages: brandedMessages(
    locals.session
      ? messagesFor(locals.locale.locale)
      : messagesFor(locals.locale.locale, [...ANONYMOUS_NAMESPACES, ...PUBLIC_MODULE_NS]),
  ),
});
