import { describe, expect, test } from 'bun:test';
import {
  emailDomainAllowed,
  googleAuthorizeUrl,
  parseDomainList,
  parseGoogleUserinfo,
  pkceChallenge,
  pkcePair,
} from '../src/oauth.ts';

describe('PKCE (RFC 7636)', () => {
  test('S256 challenge matches the RFC appendix B vector', () => {
    // https://www.rfc-editor.org/rfc/rfc7636#appendix-B
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  test('a pair is fresh each time and self-consistent', () => {
    const a = pkcePair();
    const b = pkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceChallenge(a.verifier)).toBe(a.challenge);
  });
});

describe('googleAuthorizeUrl', () => {
  test('carries client, redirect, state, PKCE and the minimal scopes', () => {
    const u = new URL(
      googleAuthorizeUrl({
        clientId: 'cid.apps.googleusercontent.com',
        redirectUri: 'https://app.example.com/auth/google/callback',
        state: 'st4te',
        codeChallenge: 'ch4llenge',
        hostedDomain: 'example.com',
      }),
    );
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com');
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.example.com/auth/google/callback');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('state')).toBe('st4te');
    expect(u.searchParams.get('code_challenge')).toBe('ch4llenge');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('prompt')).toBe('select_account');
    expect(u.searchParams.get('hd')).toBe('example.com');
  });
  test('omits hd and login_hint when not given', () => {
    const u = new URL(
      googleAuthorizeUrl({
        clientId: 'c',
        redirectUri: 'https://x/cb',
        state: 's',
        codeChallenge: 'k',
      }),
    );
    expect(u.searchParams.has('hd')).toBe(false);
    expect(u.searchParams.has('login_hint')).toBe(false);
  });
});

describe('domain allowlist', () => {
  test('parses commas, whitespace and a leading @', () => {
    expect(parseDomainList(' Example.com, @other.id\nthird.org ,')).toEqual([
      'example.com',
      'other.id',
      'third.org',
    ]);
    expect(parseDomainList(null)).toEqual([]);
  });
  test('empty list admits everyone; otherwise exact domain match', () => {
    expect(emailDomainAllowed('a@anything.test', [])).toBe(true);
    expect(emailDomainAllowed('a@example.com', ['example.com'])).toBe(true);
    expect(emailDomainAllowed('a@EXAMPLE.com', ['example.com'])).toBe(true);
    expect(emailDomainAllowed('a@sub.example.com', ['example.com'])).toBe(false);
    expect(emailDomainAllowed('a@evil.com', ['example.com'])).toBe(false);
    expect(emailDomainAllowed('no-at-sign', ['example.com'])).toBe(false);
  });
});

describe('parseGoogleUserinfo', () => {
  test('normalises a full document', () => {
    expect(
      parseGoogleUserinfo({
        sub: '1234567890',
        email: 'Person@Example.com ',
        email_verified: true,
        name: 'A Person',
        picture: 'https://lh3.googleusercontent.com/a/x',
        hd: 'Example.com',
      }),
    ).toEqual({
      sub: '1234567890',
      email: 'person@example.com',
      emailVerified: true,
      name: 'A Person',
      avatarUrl: 'https://lh3.googleusercontent.com/a/x',
      hostedDomain: 'example.com',
    });
  });
  test('falls back to the local part as name; refuses non-https pictures', () => {
    const id = parseGoogleUserinfo({ sub: 's', email: 'x@y.z', picture: 'http://plain/x' });
    expect(id?.name).toBe('x');
    expect(id?.avatarUrl).toBeNull();
    expect(id?.emailVerified).toBe(false);
    expect(id?.hostedDomain).toBeNull();
  });
  test('rejects documents without sub or e-mail', () => {
    expect(parseGoogleUserinfo(null)).toBeNull();
    expect(parseGoogleUserinfo({ email: 'x@y.z' })).toBeNull();
    expect(parseGoogleUserinfo({ sub: 's', email: 'not-an-email' })).toBeNull();
  });
});
