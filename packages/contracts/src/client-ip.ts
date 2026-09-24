/**
 * Which address in `X-Forwarded-For` is "the client" (PRD A-2 rate limits, D-5 last-active IP,
 * audit log). Behind NAT or a chain of reverse proxies the header reads
 * `client, proxy1, proxy2, …`: every hop appends the address it saw, so the entries on the
 * right are private addresses of our own infrastructure and the real visitor sits further left.
 *
 * Rule: walk from the right and skip every private / loopback / link-local address; the first
 * public one is the client. When every entry is private (a visitor on the same LAN, tests, a
 * laptop with no proxy at all) the leftmost entry is the client. Fixed-depth schemes such as
 * adapter-node's `XFF_DEPTH` break as soon as one more NAT hop appears in front — this rule
 * needs no configuration and cannot be spoofed by an internet visitor, because the address the
 * outermost proxy appends is always examined first.
 */

/** Private, loopback, link-local and unspecified ranges — proxies and NAT hops, never a visitor. */
export function isPrivateAddress(raw: string): boolean {
  const ip = stripPort(raw).toLowerCase();
  if (ip === '' || ip === 'unknown') return true;
  // IPv4 (also embedded as ::ffff:a.b.c.d).
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      // 100.64.0.0/10 — carrier-grade NAT, the operator's side of a NAT, not a visitor
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (ip.includes(':')) {
    if (ip === '::' || ip === '::1') return true;
    // fc00::/7 (unique local) and fe80::/10 (link-local)
    return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
  }
  // Not an IP literal at all (a hostname, garbage): never trust it as the visitor.
  return true;
}

/** `1.2.3.4:5678` → `1.2.3.4`, `[2001:db8::1]:443` → `2001:db8::1`; bare addresses pass through. */
function stripPort(raw: string): string {
  const s = raw.trim();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket) return bracket[1] ?? s;
  // One colon = IPv4 with port; more = an IPv6 literal without brackets, leave it alone.
  const colons = s.split(':').length - 1;
  if (colons === 1) return s.slice(0, s.indexOf(':'));
  return s;
}

/**
 * The visitor's address from an `X-Forwarded-For` value, else `fallback` (the socket address).
 * Returns `null` only when both are empty.
 */
export function clientIpFromForwarded(
  forwardedFor: string | null | undefined,
  fallback?: string | null,
): string | null {
  const hops = (forwardedFor ?? '')
    .split(',')
    .map((h) => stripPort(h))
    .filter((h) => h !== '');
  if (hops.length === 0) return fallback?.trim() || null;
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i] as string;
    if (!isPrivateAddress(hop)) return hop;
  }
  return hops[0] ?? null;
}
