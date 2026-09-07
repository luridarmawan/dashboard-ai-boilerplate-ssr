import { describe, expect, test } from 'bun:test';
import { resolveSmtp } from '../src/mail.ts';

/** J-1 / E-6: .env bootstraps SMTP; a filled setting wins field by field. */
const empty = {
  host: null,
  port: null,
  user: null,
  password: null,
  fromName: null,
  fromAddress: null,
};
const envFull = {
  SMTP_HOST: 'smtp.env.test',
  SMTP_PORT: 465,
  SMTP_USER: 'env-user',
  SMTP_PASSWORD: 'env-pass',
  MAIL_FROM_ADDRESS: 'noreply@env.test',
  MAIL_FROM_NAME: 'Env App',
};

describe('resolveSmtp', () => {
  test('nothing anywhere → no SMTP (outbox keeps rows pending / logs outside production)', () => {
    expect(resolveSmtp({ setting: empty, env: {}, appName: 'Dashboard' })).toBeNull();
  });
  test('.env alone is enough', () => {
    expect(resolveSmtp({ setting: empty, env: envFull, appName: 'Dashboard' })).toEqual({
      host: 'smtp.env.test',
      port: 465,
      user: 'env-user',
      password: 'env-pass',
      fromName: 'Env App',
      fromAddress: 'noreply@env.test',
    });
  });
  test('settings win per field; missing fields fall back to .env, then to defaults', () => {
    const r = resolveSmtp({
      setting: { ...empty, host: 'smtp.db.test', fromAddress: 'hello@db.test' },
      env: { ...envFull, SMTP_SECURE: true },
      appName: 'Dashboard',
    });
    expect(r?.host).toBe('smtp.db.test');
    expect(r?.fromAddress).toBe('hello@db.test');
    expect(r?.port).toBe(465); // from env
    expect(r?.user).toBe('env-user');
    expect(r?.secure).toBeUndefined(); // host from settings → port rule decides TLS
    const onlyHost = resolveSmtp({
      setting: empty,
      env: { SMTP_HOST: 'h', MAIL_FROM_ADDRESS: 'a@b.c' },
      appName: 'Toko',
    });
    expect(onlyHost).toEqual({
      host: 'h',
      port: 587,
      user: null,
      password: null,
      fromName: 'Toko',
      fromAddress: 'a@b.c',
    });
  });
  test('SMTP_SECURE forces TLS mode when the host comes from .env', () => {
    expect(
      resolveSmtp({
        setting: empty,
        env: { ...envFull, SMTP_PORT: 2525, SMTP_SECURE: true },
        appName: 'x',
      })?.secure,
    ).toBe(true);
  });
  test('host from .env but from-address only in settings still works (and vice versa)', () => {
    expect(
      resolveSmtp({
        setting: { ...empty, fromAddress: 'a@b.c' },
        env: { SMTP_HOST: 'h' },
        appName: 'x',
      })?.host,
    ).toBe('h');
    expect(
      resolveSmtp({
        setting: { ...empty, host: 'h' },
        env: { MAIL_FROM_ADDRESS: 'a@b.c' },
        appName: 'x',
      })?.fromAddress,
    ).toBe('a@b.c');
  });
});
