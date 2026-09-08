import { describe, expect, test } from 'bun:test';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  totpAt,
  verifyTotp,
} from '../src/totp.ts';

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890" (ASCII).
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('TOTP + recovery codes (A-11)', () => {
  test('base32 round-trips and tolerates lower case / separators', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
    const s = base32Encode(bytes);
    expect(Array.from(base32Decode(s))).toEqual(Array.from(bytes));
    expect(Array.from(base32Decode(s.toLowerCase().replace(/(.{4})/g, '$1 ')))).toEqual(
      Array.from(bytes),
    );
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  test('RFC 6238 test vectors (SHA-1, 30 s, last 6 of the 8-digit vectors)', async () => {
    expect(await totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(await totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(await totpAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe('005924');
    expect(await totpAt(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe('07081804');
  });

  test('verify: ±1 step window, spaces tolerated, replay of an accepted step refused, junk refused', async () => {
    const now = new Date(1111111109 * 1000);
    const step = Math.floor(1111111109 / 30);
    expect(await verifyTotp(RFC_SECRET, '081 804', { now })).toBe(step);
    // Previous step still accepted (clock skew), the one before that is not.
    expect(await verifyTotp(RFC_SECRET, await totpAt(RFC_SECRET, step - 1), { now })).toBe(
      step - 1,
    );
    expect(await verifyTotp(RFC_SECRET, await totpAt(RFC_SECRET, step - 2), { now })).toBeNull();
    // Replay: a step at or before lastStep never verifies again.
    expect(await verifyTotp(RFC_SECRET, '081804', { now, lastStep: step })).toBeNull();
    expect(await verifyTotp(RFC_SECRET, 'abcdef', { now })).toBeNull();
    expect(await verifyTotp(RFC_SECRET, '000000', { now })).toBeNull();
  });

  test('otpauth URL carries issuer, account, secret and parameters; recovery codes are unique and hash stably', () => {
    const url = otpauthUrl('Dash board', 'a@b.id', 'ABC234');
    expect(url).toBe(
      'otpauth://totp/Dash%20board:a%40b.id?secret=ABC234&issuer=Dash%20board&algorithm=SHA1&digits=6&period=30',
    );
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(hashRecoveryCode('ABCD-EFGH-JKLM')).toBe(hashRecoveryCode('abcd efgh jklm'));
  });
});
