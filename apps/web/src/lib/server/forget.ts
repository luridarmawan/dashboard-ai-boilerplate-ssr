import { APP_COOKIES } from './cookies.ts';

/**
 * A deliberate logout (A-5) leaves nothing of the person behind in the browser: every cookie
 * this app writes — the session and its companions, but also the cached preferences (theme,
 * mode, language, direction, sidebar), which belong to the person who just left and must not be
 * inherited by the next one at a shared machine — plus Web Storage through `Clear-Site-Data`.
 *
 * `Clear-Site-Data: "storage"` wipes localStorage, sessionStorage, IndexedDB, Cache Storage and
 * service workers of THIS origin, and works without JavaScript. `"cookies"` is deliberately not
 * used: it clears the whole registrable domain, i.e. every sibling application too — our cookies
 * are deleted one by one instead. Browsers without the header fall back to the client-side
 * `forgetBrowserStorage()` that the logout form runs before submitting.
 */
export const CLEAR_SITE_DATA_HEADER = 'clear-site-data';
export const CLEAR_SITE_DATA_VALUE = '"storage"';

/** Structural shape only, so the behaviour is testable without a whole SvelteKit event. */
export function forgetBrowser(event: {
  readonly cookies: { delete(name: string, opts: { path: string }): void };
  setHeaders(headers: Record<string, string>): void;
}): void {
  for (const { name, path } of APP_COOKIES) event.cookies.delete(name, { path });
  event.setHeaders({ [CLEAR_SITE_DATA_HEADER]: CLEAR_SITE_DATA_VALUE });
}
