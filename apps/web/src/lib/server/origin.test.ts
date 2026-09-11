import { afterEach, describe, expect, test } from 'bun:test';
import {
  allowedOrigins,
  checkOrigin,
  checkRequestOrigin,
  forwardedOrigin,
  parseOrigins,
} from './origin.ts';

const before = { origins: process.env.APP_ORIGIN, node: process.env.NODE_ENV };
afterEach(() => {
  for (const [key, value] of [
    ['APP_ORIGIN', before.origins],
    ['NODE_ENV', before.node],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const post = (origin: string | null, url = 'https://app.example.com/theme') =>
  checkRequestOrigin({
    request: new Request(url, {
      method: 'POST',
      headers: origin ? { origin } : {},
    }),
    url: new URL(url),
  });

describe('parseOrigins (cermin @core/config)', () => {
  test('entri bawa skema dipakai apa adanya, host telanjang jadi http + https', () => {
    expect(parseOrigins('https://app.example.com')).toEqual(['https://app.example.com']);
    expect(parseOrigins('localhost:3000')).toEqual([
      'http://localhost:3000',
      'https://localhost:3000',
    ]);
  });

  test('path dibuang, huruf besar diturunkan, entri kosong/rusak diabaikan', () => {
    expect(parseOrigins(' HTTPS://App.Example.COM/masuk , , :: ')).toEqual([
      'https://app.example.com',
    ]);
    expect(parseOrigins(undefined)).toEqual([]);
  });
});

describe('checkOrigin (A-10)', () => {
  const allowed = ['https://app.example.com'];

  test('GET/HEAD/OPTIONS tidak pernah diperiksa', () => {
    for (const method of ['GET', 'head', 'OPTIONS'])
      expect(checkOrigin({ method, origin: 'https://jahat.test', referer: null, allowed }).ok).toBe(
        true,
      );
  });

  test('Origin cocok lolos; Referer dipakai bila Origin tidak ada', () => {
    expect(
      checkOrigin({ method: 'POST', origin: allowed[0] ?? '', referer: null, allowed }).ok,
    ).toBe(true);
    expect(
      checkOrigin({
        method: 'POST',
        origin: null,
        referer: 'https://app.example.com/auth/login',
        allowed,
      }).ok,
    ).toBe(true);
  });

  test('origin lain dan origin yang tidak dikirim ditolak, dengan sebabnya', () => {
    expect(
      checkOrigin({ method: 'POST', origin: 'https://jahat.test', referer: null, allowed }),
    ).toMatchObject({ ok: false, reason: 'origin_mismatch', seen: 'https://jahat.test' });
    expect(checkOrigin({ method: 'POST', origin: null, referer: null, allowed })).toMatchObject({
      ok: false,
      reason: 'origin_missing',
    });
  });
});

describe('allow-list dari APP_ORIGIN saat runtime', () => {
  test('APP_ORIGIN menang atas origin hasil rekonstruksi', () => {
    // Eksplisit: `bun test` yang memuat .env repo ini akan membawa NODE_ENV=development, dan dev
    // sengaja ikut menerima origin request (lihat test terakhir).
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'https://apps.carik.id,localhost:8080';
    expect(allowedOrigins(new URL('http://127.0.0.1:3010/'))).toEqual([
      'https://apps.carik.id',
      'http://localhost:8080',
      'https://localhost:8080',
    ]);
    // Inilah kasus yang tadinya gagal: proxy depan tidak meneruskan X-Forwarded-Proto/Host, jadi
    // web merekonstruksi origin internalnya, sementara browser mengirim domain publik.
    expect(post('https://apps.carik.id', 'http://127.0.0.1:3010/theme').ok).toBe(true);
    expect(post('https://apps.carik.id/', 'http://127.0.0.1:3010/theme').ok).toBe(true);
  });

  test('tanpa APP_ORIGIN: hanya origin request itu sendiri (perilaku bawaan SvelteKit)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_ORIGIN;
    expect(post('https://app.example.com').ok).toBe(true);
    expect(post('https://lain.example.com')).toMatchObject({
      ok: false,
      reason: 'origin_mismatch',
    });
  });

  test('APP_ORIGIN yang tidak memuat domain publik tetap ditolak — pesannya menyebut daftarnya', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'http://localhost:3000';
    expect(post('https://app.example.com')).toMatchObject({
      ok: false,
      reason: 'origin_mismatch',
      allowed: ['http://localhost:3000'],
    });
  });

  test('di dev, form same-origin selalu lolos; lintas-situs tetap ditolak', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_ORIGIN = 'https://app.example.com';
    expect(post('http://127.0.0.1:5170', 'http://127.0.0.1:5170/theme').ok).toBe(true);
    expect(post('https://jahat.test', 'http://127.0.0.1:5170/theme').ok).toBe(false);
  });
});

describe('forwardedOrigin — nilai yang diteruskan ke API', () => {
  const event = (headers: Record<string, string>, url = 'https://127.0.0.1:3010/auth/login') => ({
    request: new Request(url, { method: 'POST', headers }),
    url: new URL(url),
  });

  test('origin browser yang sudah lolos allow-list menang atas rekonstruksi yang salah', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'https://app.example.com';
    // Rekonstruksi web salah (proxy tidak meneruskan X-Forwarded-*): tanpa ini API akan menolak
    // login dengan csrf_failed dan tautan e-mail menunjuk https://127.0.0.1:3010.
    expect(forwardedOrigin(event({ origin: 'https://app.example.com' }))).toBe(
      'https://app.example.com',
    );
  });

  test('origin asing atau tidak ada → origin request, seperti sebelumnya', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'https://app.example.com';
    expect(forwardedOrigin(event({ origin: 'https://jahat.test' }))).toBe('https://127.0.0.1:3010');
    expect(forwardedOrigin(event({}))).toBe('https://127.0.0.1:3010');
  });
});
