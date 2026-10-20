import { describe, expect, test } from 'bun:test';
import { hashPassword, needsRehash, passwordProblems, verifyPassword } from '../src/password.ts';
import { parseRule, rateLimitHeaders } from '../src/rate-limit.ts';
import { hashToken, looksLikeToken, randomToken, timingSafeEqual } from '../src/tokens.ts';

describe('password (A-1)', () => {
  test('argon2id round-trip; wrong password and missing hash fail', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash('$2b$10$bcrypt')).toBe(true);
  });
  test('bcrypt verifies natively; foreign formats only through a matching verifier', async () => {
    const bcrypt = await Bun.password.hash('correct horse battery', 'bcrypt');
    expect(await verifyPassword('correct horse battery', bcrypt)).toBe(true);
    const legacy = [
      {
        name: 'x.reverse',
        matches: (h: string) => h.startsWith('$rev$'),
        verify: (p: string, h: string) => h === `$rev$${[...p].reverse().join('')}`,
      },
      {
        name: 'x.broken',
        matches: (h: string) => h.startsWith('$boom$'),
        verify: () => {
          throw new Error('boom');
        },
      },
    ];
    const lookups: number[] = [];
    const lazy = () => {
      lookups.push(1);
      return legacy;
    };
    expect(await verifyPassword('abc', '$rev$cba', lazy)).toBe(true);
    expect(await verifyPassword('abd', '$rev$cba', lazy)).toBe(false);
    expect(await verifyPassword('abc', '$boom$x', lazy)).toBe(false);
    expect(await verifyPassword('abc', '$unknown$abc', lazy)).toBe(false);
    expect(await verifyPassword('abc', '$rev$cba')).toBe(false);
    // Native hashes never consult the module verifiers.
    const before = lookups.length;
    await verifyPassword('correct horse battery', bcrypt, lazy);
    expect(lookups.length).toBe(before);
  });
  test('policy', () => {
    expect(passwordProblems('short')).toEqual(['minimal 10 karakter']);
    expect(passwordProblems(' padded password ')).toContain('tidak boleh diawali/diakhiri spasi');
    expect(passwordProblems('a perfectly fine one')).toEqual([]);
  });
});

describe('tokens', () => {
  test('random tokens are 43-char base64url and hash to 64 hex', () => {
    const t = randomToken();
    expect(looksLikeToken(t)).toBe(true);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(randomToken()).not.toBe(t);
    expect(looksLikeToken('short')).toBe(false);
    expect(looksLikeToken(undefined)).toBe(false);
  });
  test('timingSafeEqual', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
  });
});

describe('rate limit rule & headers (N-7)', () => {
  test('parse and headers', () => {
    expect(parseRule('10/900')).toEqual({ limit: 10, windowSeconds: 900 });
    expect(() => parseRule('ten per minute')).toThrow(/tidak valid/);
    const h = rateLimitHeaders({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: new Date(Date.now() + 30_000),
    });
    expect(h['RateLimit-Limit']).toBe('10');
    expect(Number(h['Retry-After'])).toBeGreaterThan(0);
    expect(
      rateLimitHeaders({ allowed: true, limit: 10, remaining: 3, resetAt: new Date() })[
        'Retry-After'
      ],
    ).toBeUndefined();
  });
});
