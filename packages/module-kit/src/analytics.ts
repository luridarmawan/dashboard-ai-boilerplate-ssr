/**
 * Analytics events from pages and modules. A module calls `track('<ns>.<name>', params)` from
 * browser code; the web shell forwards it to the configured provider when analytics is on, the
 * visitor consented and the current page's area is tracked — otherwise the call does nothing.
 * Callers never check any of that themselves, and nothing here knows which provider is in use.
 *
 * The shell and the caller are decoupled through one DOM event on `window`, so a module does not
 * import anything from the web app and a call made while analytics is off costs one dispatch.
 */

export type AnalyticsParams = Readonly<Record<string, string | number | boolean>>;

/** The `window` event the web shell listens to. `detail` is `AnalyticsEventDetail`. */
export const ANALYTICS_EVENT = 'core:analytics';

export interface AnalyticsEventDetail {
  readonly name: string;
  readonly params: AnalyticsParams;
}

/** `<ns>.<name>` for module events; core's own events carry no namespace (`login`, `search`). */
const NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;
const PARAM_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
/** Keys that smell like personal data are dropped whatever their value. */
const PERSONAL_KEY_RE =
  /(^|_)(e?mail|phone|tel|name|first|last|user|username|address|ip|token|password|secret|nik|ssn|dob|birth)(_|$)/;
const MAX_PARAMS = 20;
const MAX_STRING = 100;
/** GA4 event names: letters, digits, underscore, at most 40 characters. */
const MAX_EVENT_NAME = 40;

/**
 * The event name as providers accept it (`example.item_created` → `example_item_created`), or
 * null when it is not a valid `<ns>.<name>` / core name.
 */
export function analyticsEventName(name: string): string | null {
  if (!NAME_RE.test(name)) return null;
  const flat = name.replace('.', '_');
  return flat.length <= MAX_EVENT_NAME ? flat : null;
}

/**
 * Only short scalar values under plain snake_case keys survive; anything that looks like personal
 * data, nested objects, and overlong strings are dropped. Applied by `track()` and again by the
 * shell, so a caller dispatching the DOM event by hand gets the same treatment.
 */
export function sanitizeAnalyticsParams(
  params: unknown,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!params || typeof params !== 'object') return out;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PARAMS) break;
    if (!PARAM_KEY_RE.test(key) || PERSONAL_KEY_RE.test(key)) continue;
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string' && value.length <= MAX_STRING) out[key] = value;
  }
  return out;
}

/** Send one analytics event. Safe to call during SSR (no-op) and while analytics is off. */
export function track(name: string, params: AnalyticsParams = {}): void {
  // Typed structurally: this package builds without the DOM lib, and on the server (no
  // `document`) there is nobody to deliver the event to.
  const g = globalThis as { document?: unknown; dispatchEvent?: (e: Event) => boolean };
  if (!g.document || !g.dispatchEvent || typeof CustomEvent === 'undefined') return;
  if (!analyticsEventName(name)) return;
  const detail: AnalyticsEventDetail = { name, params: sanitizeAnalyticsParams(params) };
  g.dispatchEvent(new CustomEvent(ANALYTICS_EVENT, { detail }));
}
