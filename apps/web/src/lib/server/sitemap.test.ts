import { describe, expect, test } from 'bun:test';
import { escapeXml, mergeEntries, renderSitemap, staticEntries } from './sitemap.ts';

const routes = [
  { path: '/hello-dummy', ns: 'dummy', sitemap: true },
  { path: '/example', ns: 'example', sitemap: true },
  { path: '/catalog', ns: 'example', sitemap: true },
  { path: '/product/[slug]', ns: 'example', sitemap: false },
  { path: '/resolve', ns: 'example', sitemap: false },
  { path: '/posts/[id]', ns: 'blog', sitemap: true },
] as const;
const paths = (entries: { path: string }[]) => entries.map((e) => e.path);

describe('sitemap static entries (F-7)', () => {
  test('`/` always, module pages only when enabled, flagged and parameter-free', () => {
    const all = staticEntries({
      routes,
      enabled: new Set(['dummy', 'example', 'blog']),
      landing: null,
    });
    expect(paths(all)).toEqual(['/', '/hello-dummy', '/example', '/catalog']);
    const some = staticEntries({ routes, enabled: new Set(['example']), landing: null });
    expect(paths(some)).toEqual(['/', '/example', '/catalog']);
  });

  test('utility pages are not sitemap material', () => {
    const all = staticEntries({ routes, enabled: new Set(['example']), landing: null });
    expect(paths(all)).not.toContain('/theme');
    expect(paths(all)).not.toContain('/lang');
  });

  test('the landing target is listed once, as `/` (one URL per content)', () => {
    const withLanding = staticEntries({
      routes,
      enabled: new Set(['example']),
      landing: '/example',
    });
    expect(paths(withLanding)).toEqual(['/', '/catalog']);
    const catalogLanding = staticEntries({
      routes,
      enabled: new Set(['example']),
      landing: '/catalog',
    });
    expect(paths(catalogLanding)).toEqual(['/', '/example']);
    // A landing that is `/` itself (built-in page) hides nothing.
    const builtIn = staticEntries({ routes, enabled: new Set(['example']), landing: null });
    expect(paths(builtIn)).toContain('/example');
  });
});

describe('sitemap merge + render', () => {
  test('keeps the first occurrence of a path and drops entries that are not paths on this origin', () => {
    const merged = mergeEntries(
      [{ path: '/' }, { path: '/catalog' }],
      [
        { path: '/product/a', lastmod: '2026-10-01T00:00:00.000Z' },
        { path: '/catalog', lastmod: '2026-10-01T00:00:00.000Z' },
        { path: 'https://evil.example/x' },
        { path: '//evil.example/x' },
        { path: '/ok\nSitemap: x' },
        { nope: true },
        null,
      ],
      null,
      undefined,
    );
    expect(merged).toEqual([
      { path: '/' },
      { path: '/catalog' },
      { path: '/product/a', lastmod: '2026-10-01T00:00:00.000Z' },
    ]);
  });

  test('renders sitemaps.org XML with escaped locations and optional lastmod', () => {
    const xml = renderSitemap('https://shop.example', [
      { path: '/' },
      { path: '/search?q=a&b=<c>', lastmod: '2026-10-02' },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
    expect(xml).toContain('<url><loc>https://shop.example/</loc></url>');
    expect(xml).toContain(
      '<url><loc>https://shop.example/search?q=a&amp;b=&lt;c&gt;</loc><lastmod>2026-10-02</lastmod></url>',
    );
    expect(xml.endsWith('</urlset>\n')).toBe(true);
    expect(xml).not.toContain('&b=<');
  });

  test('escapeXml covers the five reserved characters', () => {
    expect(escapeXml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
  });
});
