import { describe, expect, test } from 'bun:test';
import {
  canonicalPath,
  isNeverTrapped,
  ORIGINAL_PATH_HEADER,
  parseOriginalPath,
  trappedPath,
  wantsHtml,
} from './trap.ts';

describe('404 trapper helpers (§4.7 rule 6)', () => {
  test('system prefixes, dot-files and well-known files are never trapped', () => {
    for (const p of [
      '/_app/immutable/x.js',
      '/v1/nope',
      '/api',
      '/m/example/products/x',
      '/auth/whatever',
      '/files/abc/content',
      '/.well-known/security.txt',
      '/.env',
      '/wp/.git/config',
      '/favicon.ico',
      '/robots.txt',
      '/sitemap.xml',
      '/dashboard/deep',
    ])
      expect(isNeverTrapped(p), p).toBe(true);
    for (const p of ['/furniture', '/sanitary/', '/kotak-penyimpanan-p-blue', '/blog/2026/hello'])
      expect(isNeverTrapped(p), p).toBe(false);
    // A prefix match is by segment: `/apiary` is not `/api`.
    expect(isNeverTrapped('/apiary')).toBe(false);
  });

  test('only requests that ask for HTML are trapped', () => {
    const req = (accept?: string) =>
      new Request('http://web.test/x', accept ? { headers: { accept } } : {});
    expect(wantsHtml(req('text/html,application/xhtml+xml,*/*;q=0.8'))).toBe(true);
    expect(wantsHtml(req('application/json'))).toBe(false);
    expect(wantsHtml(req('*/*'))).toBe(false);
    expect(wantsHtml(req())).toBe(false);
  });

  test('the original path header is parsed, and anything that is not a local path is dropped', () => {
    expect(parseOriginalPath('/furniture')).toEqual({ pathname: '/furniture', search: '' });
    expect(parseOriginalPath('/furniture?page=2&x=1')).toEqual({
      pathname: '/furniture',
      search: '?page=2&x=1',
    });
    expect(parseOriginalPath(null)).toBeNull();
    expect(parseOriginalPath('')).toBeNull();
    expect(parseOriginalPath('furniture')).toBeNull();
    expect(parseOriginalPath('//evil.example/x')).toBeNull();
    expect(parseOriginalPath('https://evil.example/x')).toBeNull();
    expect(parseOriginalPath('/x\r\nInjected: 1')).toBeNull();
  });

  test('trappedPath reads the header off the event, null on a direct visit', () => {
    const withHeader = {
      request: new Request('http://web.test/resolve', {
        headers: { [ORIGINAL_PATH_HEADER]: '/sanitary' },
      }),
    };
    expect(trappedPath(withHeader)).toEqual({ pathname: '/sanitary', search: '' });
    expect(trappedPath({ request: new Request('http://web.test/resolve') })).toBeNull();
  });
});

describe('canonical path (R-4: one URL per content)', () => {
  test('the landing target is canonical at `/`, reached directly or as `/`', () => {
    expect(canonicalPath({ visible: '/example', route: '/example', landing: '/example' })).toBe(
      '/',
    );
    expect(canonicalPath({ visible: '/', route: '/example', landing: '/example' })).toBe('/');
    expect(canonicalPath({ visible: '/?utm=x', route: '/example', landing: '/example' })).toBe('/');
  });

  test('any other page is canonical at the visible address, without the query', () => {
    expect(canonicalPath({ visible: '/catalog', route: '/catalog', landing: '/example' })).toBe(
      '/catalog',
    );
    expect(
      canonicalPath({
        visible: '/catalog?q=kopi&sort=price',
        route: '/catalog',
        landing: '/example',
      }),
    ).toBe('/catalog');
    // Built-in landing (`/`): the module page keeps its own address.
    expect(canonicalPath({ visible: '/example', route: '/example', landing: null })).toBe(
      '/example',
    );
    // Trapped (F-11): the visitor's root URL, not the handler page.
    expect(canonicalPath({ visible: '/furniture', route: '/resolve', landing: '/example' })).toBe(
      '/furniture',
    );
  });

  test('a visible path that is not a path on this origin falls back to `/`', () => {
    expect(canonicalPath({ visible: '//evil', route: '/x', landing: null })).toBe('/');
    expect(canonicalPath({ visible: 'nope', route: '/x', landing: null })).toBe('/');
  });
});
