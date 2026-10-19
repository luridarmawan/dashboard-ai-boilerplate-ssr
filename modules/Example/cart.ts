/**
 * The demo cart of the Example module — what a shop module puts in the public header's
 * `public-actions` slot. Deliberately small: no table, no checkout. The cart lives in ONE cookie
 * on the visitor's browser (`example_cart`), so it needs no server state and survives
 * `--scale api=3` without a shared store. The web reads it (the `/cart` page server-side, the
 * header icon in the browser — the cookie is not httpOnly, it holds nothing secret) and the API
 * only prices what it is handed (`GET /v1/m/example/cart?items=…`): the web forwards core
 * cookies to the API, never a module's.
 *
 * A real shop keeps the cart in its own table keyed by session or user; replace this file, keep
 * the shape of `GET /cart` and the pages do not change.
 *
 * Wire format: `slug:qty` pairs joined by `.`, e.g. `kopi-gayo:2.v60-dripper:1` — every character
 * is cookie-safe, so the value needs no encoding.
 */
export const CART_COOKIE = 'example_cart';
/** Distinct products per cart and units per line; anything beyond is dropped, not an error. */
export const CART_MAX_LINES = 30;
export const CART_MAX_QTY = 99;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export interface CartLine {
  readonly slug: string;
  readonly qty: number;
}

/** Reads a cookie value leniently: malformed pairs are skipped, duplicates merged. */
export function parseCart(raw: string | null | undefined): CartLine[] {
  const qty = new Map<string, number>();
  for (const pair of (raw ?? '').split('.')) {
    const [slug = '', n = ''] = pair.split(':');
    const q = Number.parseInt(n, 10);
    if (!SLUG_RE.test(slug) || !Number.isFinite(q) || q < 1) continue;
    qty.set(slug, Math.min(CART_MAX_QTY, (qty.get(slug) ?? 0) + q));
  }
  return [...qty].slice(0, CART_MAX_LINES).map(([slug, q]) => ({ slug, qty: q }));
}

export function formatCart(lines: readonly CartLine[]): string {
  return lines
    .filter((l) => SLUG_RE.test(l.slug) && l.qty > 0)
    .slice(0, CART_MAX_LINES)
    .map((l) => `${l.slug}:${Math.min(CART_MAX_QTY, Math.floor(l.qty))}`)
    .join('.');
}

/** `qty` added to the line (negative removes units); a line that reaches 0 is removed. */
export function changeCart(lines: readonly CartLine[], slug: string, qty: number): CartLine[] {
  if (!SLUG_RE.test(slug)) return [...lines];
  const next = lines.map((l) => ({ ...l }));
  const line = next.find((l) => l.slug === slug);
  if (line) line.qty = Math.min(CART_MAX_QTY, line.qty + qty);
  else if (qty > 0) next.push({ slug, qty: Math.min(CART_MAX_QTY, qty) });
  return next.filter((l) => l.qty > 0).slice(0, CART_MAX_LINES);
}
