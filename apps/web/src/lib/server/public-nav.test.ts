import { describe, expect, test } from 'bun:test';
import { definePublicRoutes } from '@core/module-kit';
import type { SiteMenuItem } from '@core/module-kit/site-menu';
import { publicNavLinks, resolveSiteMenu } from './public-nav.ts';

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

describe('admin header rows (site.menubar, site.topbar)', () => {
  const item = (id: string, href: string | null, children: SiteMenuItem[] = []): SiteMenuItem => ({
    label: { id, en: `${id}-en` },
    href,
    children,
  });
  const menu = [
    item('Beranda', '/'),
    item('Kategori', null, [item('Kopi', '/kopi', [item('Arabika', '/kopi/arabika')])]),
    item('Toko', '/shop'),
    item('Toko saja', null, [item('Promo', '/shop/promo')]),
    item('Luar', 'https://example.com'),
    item('Gratis ongkir', null),
  ];
  const owner = (p: string) => (p.startsWith('/shop') ? 'shop' : null);
  const resolve = (enabled: string[], path = '/', locale = 'id') =>
    resolveSiteMenu(menu, { locale, path, search: '', owner, enabled: new Set(enabled) });

  test('links into a disabled module go, and so does a heading left empty', () => {
    expect(resolve([]).map((l) => l.label)).toEqual([
      'Beranda',
      'Kategori',
      'Luar',
      'Gratis ongkir',
    ]);
    expect(resolve(['shop']).map((l) => l.label)).toContain('Toko saja');
  });

  test('current page and the trail to it', () => {
    const [home, cat] = resolve([], '/kopi/arabika');
    // The root only matches itself, or every page would light it up.
    expect(home?.current).toBe(false);
    expect(cat?.active).toBe(true);
    expect(cat?.current).toBe(false);
    expect(cat?.children[0]?.current).toBe(true);
    expect(cat?.children[0]?.children[0]?.current).toBe(true);
  });

  test('labels follow the visitor language; external links are marked', () => {
    const links = resolve([], '/', 'en');
    expect(links[0]?.label).toBe('Beranda-en');
    expect(links.find((l) => l.href === 'https://example.com')?.external).toBe(true);
  });
});

describe('menu links with a query', () => {
  const menu: SiteMenuItem[] = [
    { label: { id: 'Semua', en: 'All' }, href: '/catalog', children: [] },
    { label: { id: 'Arabika', en: 'Arabica' }, href: '/catalog?q=arabika', children: [] },
  ];
  const at = (search: string) =>
    resolveSiteMenu(menu, {
      locale: 'id',
      path: '/catalog',
      search,
      owner: () => null,
      enabled: new Set(),
    }).map((l) => l.current);

  test('are current only on exactly that address', () => {
    expect(at('')).toEqual([true, false]);
    expect(at('?q=arabika')).toEqual([true, true]);
    expect(at('?q=robusta')).toEqual([true, false]);
  });
});
