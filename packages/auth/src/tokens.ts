/**
 * Opaque secrets (session cookies, API tokens, reset & verification links). The client holds
 * the random value; the database holds only its SHA-256 (hex, 64 chars — fits identifier(64)).
 */

/** 32 random bytes, base64url — 43 chars, no padding, cookie- and URL-safe. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

/** Constant-time comparison for double-submit CSRF tokens and similar. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Shape check for tokens we minted: base64url, 43 chars. */
export function looksLikeToken(t: string | undefined | null): t is string {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
}
