/**
 * URL trap rules of the Example module (F-11, PRD §4.7 rule 6) — the part of the 404 handler
 * every module author should copy first.
 *
 * HOW THE TRAP WORKS, END TO END
 *   1. A visitor asks for a URL no SvelteKit route knows, e.g. `/category-food`.
 *   2. The core (apps/web/src/hooks.server.ts) sees `event.route.id === null`, reads the tenant's
 *      `app.not_found_route` setting (Settings → Application → "404 handler") and, when it names
 *      one of THIS module's public pages (`/resolve`), fetches that page internally with the
 *      original URL in a header.
 *   3. The page's loader reads that URL with `trappedPath(event)` and asks `matchTrap()` below:
 *      "is this URL ours, and what does it mean?"
 *   4. A match renders the page under the visitor's URL with status 200; no match falls through
 *      to the database lookup (`GET /v1/m/example/resolve`) and finally to `error(404)`, which
 *      makes the core show its built-in 404 exactly as if the trap did not exist.
 *
 * WHY A RULE TABLE
 *   A shop or blog that is being rebuilt on this boilerplate has to keep its old URLs alive:
 *   `/category-food`, `/food/nasi-goreng`, `/promo/2026/lebaran.html`, whatever the previous
 *   site emitted. Those shapes cannot be declared as SvelteKit routes (extension point 13 rejects
 *   catch-alls on purpose), but a table of patterns can describe any of them, in the order they
 *   should be tried. Each rule is a regular expression plus a small function that turns the
 *   match into a typed "hit" the page knows how to render. Add a rule, add a branch in
 *   `+page.svelte`, done — no core change, no deploy of a new route.
 *
 * The two demo rules below exist to make the concept visible: `/category-<slug>` and
 * `/<category>/<item>`. Replace them with the URL shapes of the site you are migrating.
 */

/** What a trapped URL turned out to be. Extend the union as you add rules. */
export type TrapHit =
  | { kind: 'category-demo'; slug: string; name: string }
  | { kind: 'item-demo'; category: string; slug: string; name: string };

export interface TrapRule {
  /** Short, stable id shown on the demo page so a developer can see WHICH rule answered. */
  readonly id: string;
  /** Anchored pattern over the pathname (no query string), already lower-cased and trimmed. */
  readonly pattern: RegExp;
  /** Turn a match into a hit. Return null to say "looked like ours, but is not" (falls through). */
  readonly resolve: (match: RegExpExecArray) => TrapHit | null;
}

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** `nasi-goreng` → `Nasi Goreng`: good enough for a demo title; real data brings its own names. */
export function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Rules are tried top to bottom; the first hit wins. Keep the most specific shapes first.
 * `/food/nasi-goreng` must not be swallowed by a looser `/<anything>` rule placed above it.
 */
export const TRAP_RULES: readonly TrapRule[] = [
  {
    // /category-food, /category-minuman-dingin
    id: 'category-prefix',
    pattern: new RegExp(`^/category-(${SLUG})$`),
    resolve: (m) => {
      const slug = m[1] ?? '';
      return slug ? { kind: 'category-demo', slug, name: titleFromSlug(slug) } : null;
    },
  },
  {
    // /food/nasi-goreng — two segments: a category, then an item inside it
    id: 'category-item',
    pattern: new RegExp(`^/(${SLUG})/(${SLUG})$`),
    resolve: (m) => {
      const category = m[1] ?? '';
      const slug = m[2] ?? '';
      if (!category || !slug) return null;
      return { kind: 'item-demo', category, slug, name: titleFromSlug(slug) };
    },
  },
];

/**
 * Normalise what the visitor typed the way a forgiving old site would: decode, drop the query,
 * collapse trailing slashes, lower-case. Anything that cannot be decoded is nobody's URL.
 */
export function normalizeTrapPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const bare = (decoded.split('?')[0] ?? '').replace(/\/+$/, '').toLowerCase();
  if (bare.length > 512) return null;
  return bare === '' ? '/' : bare;
}

/** The first rule that recognises the path, or null when the table has nothing to say. */
export function matchTrap(
  pathname: string,
  rules: readonly TrapRule[] = TRAP_RULES,
): { rule: TrapRule; hit: TrapHit } | null {
  const path = normalizeTrapPath(pathname);
  if (!path) return null;
  for (const rule of rules) {
    const m = rule.pattern.exec(path);
    if (!m) continue;
    const hit = rule.resolve(m);
    if (hit) return { rule, hit };
  }
  return null;
}
