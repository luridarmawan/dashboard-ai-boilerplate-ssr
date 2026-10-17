import { describe, expect, test } from 'bun:test';
import { isPermalinkPath, normalizePermalink } from '@core/contracts';
import { isRoutePath, permalinkPath, planClaim } from '../src/permalinks.ts';

/** The permalink registry's rules without a database (PRD F-12): every branch of a claim. */
const base = {
  module: 'pages',
  target: 'page-a',
  current: '/about-us',
  next: '/about-our-company',
  keepHistory: true,
  holder: null,
};

describe('planClaim', () => {
  test('same path: nothing to do, and certainly no redirect onto itself', () => {
    expect(
      planClaim({
        ...base,
        next: '/about-us',
        holder: { module: 'pages', target: 'page-a', kind: 'canonical' },
      }),
    ).toEqual({ kind: 'unchanged' });
  });

  test('public content, free path: move and keep the old path as a redirect', () => {
    expect(planClaim(base)).toEqual({ kind: 'move', reclaim: false, redirectOld: true });
  });

  test('never public: move without a redirect; first claim has nothing to keep', () => {
    expect(planClaim({ ...base, keepHistory: false })).toEqual({
      kind: 'move',
      reclaim: false,
      redirectOld: false,
    });
    expect(planClaim({ ...base, current: null })).toEqual({
      kind: 'move',
      reclaim: false,
      redirectOld: false,
    });
  });

  test('a path held by other content — any module — is a conflict naming that module', () => {
    expect(
      planClaim({ ...base, holder: { module: 'articles', target: 'x', kind: 'canonical' } }),
    ).toEqual({
      kind: 'conflict',
      holder: 'content',
      module: 'articles',
    });
    expect(
      planClaim({ ...base, holder: { module: 'pages', target: 'page-b', kind: 'canonical' } }),
    ).toEqual({
      kind: 'conflict',
      holder: 'content',
      module: 'pages',
    });
  });

  test('an old path of other content is a conflict (it still redirects there)', () => {
    expect(
      planClaim({ ...base, holder: { module: 'pages', target: 'page-b', kind: 'redirect' } }),
    ).toEqual({
      kind: 'conflict',
      holder: 'redirect',
      module: 'pages',
    });
  });

  test('one of its own old paths: reclaimed, so it can never redirect to itself', () => {
    expect(
      planClaim({ ...base, holder: { module: 'pages', target: 'page-a', kind: 'redirect' } }),
    ).toEqual({
      kind: 'move',
      reclaim: true,
      redirectOld: true,
    });
  });
});

describe('permalink paths', () => {
  test('one or more slug segments, never under a core prefix', () => {
    for (const ok of ['/about-us', '/shoes/sneaker-x', '/a/b/c', '/faq-2026'])
      expect(isPermalinkPath(ok), ok).toBe(true);
    for (const bad of [
      '/',
      '',
      'about',
      '/About',
      '/a//b',
      '/a b',
      '/dashboard',
      '/v1/x',
      '/auth/login',
      '/m/pages',
      '/_app/x',
      `/${'a'.repeat(260)}`,
    ])
      expect(isPermalinkPath(bad), bad).toBe(false);
  });

  test('a visitor URL is forgiven its case, trailing slash and escapes; noise is refused', () => {
    expect(normalizePermalink('/About-Us/')).toBe('/about-us');
    expect(normalizePermalink('/about%2Dus')).toBe('/about-us');
    expect(normalizePermalink('/Shoes/Sneaker-X?ref=1')).toBe('/shoes/sneaker-x');
    for (const noise of ['/wp-login.php', '/.env', '/%E0%A4%A', '/', '/settings/x'])
      expect(normalizePermalink(noise), noise).toBeNull();
  });

  test('a wanted path may come as a bare slug', () => {
    expect(permalinkPath('about-us')).toBe('/about-us');
    expect(permalinkPath('/About-Us/')).toBe('/about-us');
    expect(permalinkPath('settings')).toBeNull();
  });

  test('paths a page of the app answers are taken', () => {
    expect(isRoutePath('/dashboard')).toBe(true);
    expect(isRoutePath('/pages')).toBe(true); // the Pages permalink page itself
    expect(isRoutePath('/about-us')).toBe(false);
  });
});
