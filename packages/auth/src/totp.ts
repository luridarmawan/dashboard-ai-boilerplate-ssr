import { hashToken } from './tokens.ts';

/**
 * TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 digits) + recovery codes for 2FA (PRD A-11). No dependency:
 * WebCrypto HMAC and a small base32 codec. Secrets are stored as base32 (what the authenticator
 * app receives); recovery codes are stored hashed, like session tokens, and each is single-use.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** 20 random bytes → 32 base32 chars, the size authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export async function totpAt(secret: string, step: number, digits = TOTP_DIGITS): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const msg = new Uint8Array(8);
  // 64-bit big-endian counter; steps fit in 32 bits for centuries, so the high word stays 0.
  let v = step;
  for (let i = 7; i >= 4; i--) {
    msg[i] = v & 255;
    v = Math.floor(v / 256);
  }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = (mac[19] as number) & 15;
  const bin =
    (((mac[offset] as number) & 127) << 24) |
    ((mac[offset + 1] as number) << 16) |
    ((mac[offset + 2] as number) << 8) |
    (mac[offset + 3] as number);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpStep(now = new Date()): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Verify a code against the current step ± `window`, refusing any step at or before `lastStep`
 * (a code is valid once — replay within the window is rejected). Returns the matched step or null.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  opts: { now?: Date; window?: number; lastStep?: number | null } = {},
): Promise<number | null> {
  const digits = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const cur = totpStep(opts.now ?? new Date());
  const w = opts.window ?? 1;
  for (let step = cur + w; step >= cur - w; step--) {
    if (opts.lastStep !== null && opts.lastStep !== undefined && step <= opts.lastStep) continue;
    if ((await totpAt(secret, step)) === digits) return step;
  }
  return null;
}

/** `otpauth://` URL for the QR code / manual entry. */
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** 10 codes of the form `abcd-efgh-ijkl` (lower-case base32 alphabet, no ambiguous chars). */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}
export const normalizeRecoveryCode = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashRecoveryCode = (c: string) => hashToken(normalizeRecoveryCode(c));
