import { describe, expect, test } from 'bun:test';
import { definePublicRoutes } from '@core/module-kit';
import { publicNavLinks } from './public-nav.ts';

const label = (id: string, en: string) => ({ id, en });
const routes = [
  { path: '/shop', ns: 'shop', nav: { label: label('Toko', 'Shop'), order: 200 } },
  { path: '/blog', ns: 'blog', nav: { label: label('Blog', 'Blog'), order: 100 } },
  { path: '/about', ns: 'shop', nav: { label: label('Tentang', 'About'), order: 200 } },
  { path: '/shop/[slug]', ns: 'shop', nav: null },
];

describe('public header links (module public routes with `nav`)', () => {
  test('ordered by order then path, labels in the visitor language', () => {
    const links = publicNavLinks(routes, new Set(['shop', 'blog']), 'id', '/');
    expect(links.map((l) => [l.href, l.label])).toEqual([
      ['/blog', 'Blog'],
      ['/about', 'Tentang'],
      ['/shop', 'Toko'],
    ]);
    expect(publicNavLinks(routes, new Set(['shop']), 'en', '/').map((l) => l.label)).toEqual([
      'About',
      'Shop',
    ]);
  });

  test('a disabled module has no links', () => {
    expect(publicNavLinks(routes, new Set(), 'id', '/')).toEqual([]);
  });

  test('current page: the link itself and the pages under it', () => {
    const at = (p: string) =>
      publicNavLinks(routes, new Set(['shop', 'blog']), 'id', p)
        .filter((l) => l.current)
        .map((l) => l.href);
    expect(at('/shop')).toEqual(['/shop']);
    expect(at('/shop/sneaker-x')).toEqual(['/shop']);
    expect(at('/shopping')).toEqual([]);
  });

  test('contract: nav only on concrete pages, with both labels and an integer order', () => {
    const ok = { path: '/shop', dir: 'web/public/shop', nav: { label: label('Toko', 'Shop') } };
    expect(definePublicRoutes('Shop', [ok])).toHaveLength(1);
    expect(() =>
      definePublicRoutes('Shop', [{ ...ok, path: '/shop/[slug]', sitemap: false }]),
    ).toThrow(/path konkret/);
    expect(() => definePublicRoutes('Shop', [{ ...ok, notFound: true }])).toThrow(/path konkret/);
    expect(() =>
      definePublicRoutes('Shop', [{ ...ok, nav: { label: label('Toko', ' ') } }]),
    ).toThrow(/id dan en/);
    expect(() =>
      definePublicRoutes('Shop', [{ ...ok, nav: { label: label('Toko', 'Shop'), order: 1.5 } }]),
    ).toThrow(/bilangan bulat/);
  });
});
