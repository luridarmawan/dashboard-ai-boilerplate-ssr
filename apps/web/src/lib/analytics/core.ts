/**
 * Visitor analytics, the provider-independent half: what the root layout hands the browser, which
 * part of the app a page belongs to, and what path is reported for it. Pure functions only, so the
 * rules that keep ids and tokens out of the provider's reports are unit-tested.
 */

/** The visitor's answer to the consent banner: `granted` / `denied`; absent = not asked yet. */
export const CONSENT_COOKIE = 'crk_consent';
/** One-shot event (`login`, `sign_up`) a server action leaves for the browser to send once. */
export const ANALYTICS_EVENT_COOKIE = 'crk_analytics_event';
/** How long the consent answer is remembered: about six months, then the visitor is asked again. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 182;

export type AnalyticsProvider = 'google';

/** What the root layout sends to the browser — null whenever analytics cannot run. */
export interface AnalyticsConfig {
  readonly provider: AnalyticsProvider;
  readonly id: string;
  readonly trackPublic: boolean;
  readonly trackDashboard: boolean;
  readonly requireConsent: boolean;
}

export type AnalyticsArea = 'public' | 'dashboard';

/** Signed-in pages live under the `(app)` route group; everything else is the public side. */
export function areaOf(routeId: string | null): AnalyticsArea {
  return routeId === '/(app)' || routeId?.startsWith('/(app)/') ? 'dashboard' : 'public';
}

export function isTracked(config: AnalyticsConfig, area: AnalyticsArea): boolean {
  return area === 'dashboard' ? config.trackDashboard : config.trackPublic;
}

/**
 * The path reported for a page. Public site pages (`(public)` group, and unmatched URLs the 404
 * page answers) report the real path — that is what marketing needs. Every other page reports its
 * route pattern with the groups removed, so `/users/0192…/edit` becomes `/users/[id]/edit` and the
 * token in `/join/<token>` or `/auth/reset/<token>` never leaves the browser. Query strings and
 * fragments are never reported.
 */
export function trackedPath(routeId: string | null, pathname: string): string {
  if (routeId === null || routeId === '/(public)' || routeId.startsWith('/(public)/'))
    return pathname || '/';
  const path = routeId.replace(/\/\([^)]+\)/g, '');
  return path === '' ? '/' : path;
}

/**
 * The browser-side twin of the server's flag: a client-side sign-in (the login page talks to the
 * API directly, then navigates) leaves the same one-shot cookie for the page it lands on.
 */
export function flagAnalyticsEventInBrowser(name: 'login' | 'sign_up'): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in every browser we support
  document.cookie = `${ANALYTICS_EVENT_COOKIE}=${name}; Path=/; Max-Age=300; SameSite=Lax${secure}`;
}

/** One cookie's value from a `document.cookie` string, or null. */
export function readCookie(cookies: string, name: string): string | null {
  for (const part of cookies.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
