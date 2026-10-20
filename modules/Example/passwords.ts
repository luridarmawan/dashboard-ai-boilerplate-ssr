import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { definePasswordVerifiers } from '@core/module-kit';

/**
 * Password verifiers (extension point 19): users imported from WordPress keep their password.
 * Copy their `user_pass` into `users.password_hash` verbatim; the core asks these verifiers only
 * for those foreign hashes and rehashes each account to Argon2id on its next successful login.
 *
 * Both formats follow `wp_check_password()` exactly:
 *   - `$wp$2y$…` (WordPress 6.8+): bcrypt over base64(HMAC-SHA384(password, 'wp-sha384'));
 *   - `$P$…` (older WordPress, phpass "portable"): salted MD5 iterated 2^n times.
 */

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** phpass' own base64 flavour (little-endian, its alphabet). */
function encode64(input: Buffer, count: number): string {
  let out = '';
  let i = 0;
  do {
    let value = input[i++] as number;
    out += ITOA64[value & 0x3f];
    if (i < count) value |= (input[i] as number) << 8;
    out += ITOA64[(value >> 6) & 0x3f];
    if (i++ >= count) break;
    if (i < count) value |= (input[i] as number) << 16;
    out += ITOA64[(value >> 12) & 0x3f];
    if (i++ >= count) break;
    out += ITOA64[(value >> 18) & 0x3f];
  } while (i < count);
  return out;
}

/** `$P$` + cost char + 8-char salt + 22 chars of hash = 34 characters. */
export function phpassCheck(plain: string, hash: string): boolean {
  if (hash.length !== 34 || !hash.startsWith('$P$')) return false;
  const log2 = ITOA64.indexOf(hash[3] as string);
  if (log2 < 7 || log2 > 30) return false;
  const salt = hash.slice(4, 12);
  const pw = Buffer.from(plain, 'utf8');
  let digest = createHash('md5').update(salt).update(pw).digest();
  for (let n = 1 << log2; n > 0; n--) digest = createHash('md5').update(digest).update(pw).digest();
  const computed = Buffer.from(hash.slice(0, 12) + encode64(digest, 16));
  const stored = Buffer.from(hash);
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

/** `$wp` + a bcrypt hash of the HMAC-SHA384 pre-hash. */
export async function wordpressBcryptCheck(plain: string, hash: string): Promise<boolean> {
  if (!hash.startsWith('$wp$2')) return false;
  const prehash = createHmac('sha384', 'wp-sha384').update(plain, 'utf8').digest('base64');
  return Bun.password.verify(prehash, hash.slice(3));
}

export default definePasswordVerifiers('Example', [
  {
    name: 'example.wordpress',
    matches: (hash) => hash.startsWith('$wp$2') || hash.startsWith('$P$'),
    verify: (plain, hash) =>
      hash.startsWith('$P$') ? phpassCheck(plain, hash) : wordpressBcryptCheck(plain, hash),
  },
]);
