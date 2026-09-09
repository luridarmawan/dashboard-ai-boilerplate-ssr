import { afterEach, describe, expect, test } from 'bun:test';
import { resetEnvCache } from '@core/config';
import { publicLink, publicOrigin } from '../src/mail.ts';

/** Links in e-mails point at the origin the user is actually on (dev port, second domain), never at a stale default. */
const req = (headers: Record<string, string>) =>
  new Request('http://127.0.0.1:3001/v1/x', { headers });
const prev = process.env.APP_ORIGIN;
afterEach(() => {
  if (prev === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = prev;
  resetEnvCache();
});

describe('publicOrigin', () => {
  test('without APP_ORIGIN: the forwarded origin of the request wins over the 5173 default', () => {
    delete process.env.APP_ORIGIN;
    resetEnvCache();
    expect(
      publicOrigin(req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': '127.0.0.1:5170' })),
    ).toBe('http://127.0.0.1:5170');
    expect(publicOrigin(req({ origin: 'http://localhost:5170' }))).toBe('http://localhost:5170');
    expect(publicOrigin(req({}))).toBe('http://127.0.0.1:5173');
    expect(publicOrigin(null)).toBe('http://127.0.0.1:5173');
    expect(
      publicLink(
        '/join/abc',
        req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': '127.0.0.1:5170' }),
      ),
    ).toBe('http://127.0.0.1:5170/join/abc');
  });
  test('with APP_ORIGIN: a listed forwarded origin is used, an unlisted one falls back to the primary', () => {
    process.env.APP_ORIGIN = 'https://app.example.com,https://apps.other.id';
    resetEnvCache();
    expect(
      publicOrigin(req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'apps.other.id' })),
    ).toBe('https://apps.other.id');
    expect(
      publicOrigin(req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.test' })),
    ).toBe('https://app.example.com');
    expect(publicOrigin(null)).toBe('https://app.example.com');
  });
});
