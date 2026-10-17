/**
 * Permalink paths (PRD F-12) — the one definition of what a module may register as a public URL
 * at the root of the site, shared by the API (which validates claims) and the web (which looks
 * unknown URLs up). A path is one or more lower-case slug segments: `/about-us`,
 * `/shoes/sneaker-x`. Anything the core already serves is off limits.
 */

/** Path prefixes the core (or the infrastructure in front of it) answers; never a permalink. */
export const CORE_PATH_PREFIXES: readonly string[] = [
  '/_app',
  '/v1',
  '/api',
  '/m',
  '/auth',
  '/dashboard',
  '/files',
  '/join',
  '/docs',
  '/metrics',
  '/settings',
  '/modules',
  '/users',
  '/groups',
  '/tenants',
  '/profile',
  '/examples',
  '/notifications',
  '/outbox',
  '/queue',
  '/webhooks',
  '/themes',
  '/permissions',
  '/theme',
  '/lang',
  '/sidebar',
  '/maintenance',
  '/.well-known',
];

const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';
const PATH_RE = new RegExp(`^(?:/${SEGMENT}){1,8}$`);
export const PERMALINK_MAX = 255;

/** True for a well-formed permalink path that is not under a core prefix. */
export function isPermalinkPath(path: string): boolean {
  if (path.length > PERMALINK_MAX || !PATH_RE.test(path)) return false;
  return !CORE_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * What a visitor's URL means as a permalink: decoded, query dropped, trailing slashes trimmed,
 * lower-cased — `/About-Us/` and `/about%2Dus` are `/about-us`. Null when it cannot be one, which
 * is most scanner noise (`/wp-login.php`, `/.env`), so it never reaches the database.
 */
export function normalizePermalink(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const path = (decoded.split('?')[0] ?? '').replace(/\/+$/, '').toLowerCase();
  return isPermalinkPath(path) ? path : null;
}
