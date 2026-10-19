import { describe, expect, test } from 'bun:test';
import { formatSiteMenu, parseSiteMenu, storedSiteMenu } from '../src/site-menu.ts';

const OUTLINE = [
  'Beranda | Home -> /',
  'Kategori | Categories',
  '  Kopi | Coffee -> /kopi',
  '    Arabika -> /kopi/arabika',
  '  Alat seduh | Brewing -> /alat',
  'Promo -> https://example.com/promo',
].join('\n');

describe('menu setting values', () => {
  test('an outline becomes a tree: two spaces per level, `id | en` labels, optional link', () => {
    const r = parseSiteMenu(OUTLINE, 4);
    if (!r.ok) throw new Error(r.message);
    expect(r.items.map((i) => [i.label.id, i.label.en, i.href])).toEqual([
      ['Beranda', 'Home', '/'],
      ['Kategori', 'Categories', null],
      ['Promo', 'Promo', 'https://example.com/promo'],
    ]);
    const coffee = r.items[1]?.children[0];
    expect(coffee?.href).toBe('/kopi');
    expect(coffee?.children[0]).toEqual({
      label: { id: 'Arabika', en: 'Arabika' },
      href: '/kopi/arabika',
      children: [],
    });
  });

  test('the outline round-trips, and JSON parses to the same tree', () => {
    const r = parseSiteMenu(OUTLINE, 4);
    if (!r.ok) throw new Error(r.message);
    expect(formatSiteMenu(r.items)).toBe(OUTLINE);
    expect(parseSiteMenu(JSON.stringify(r.items), 4)).toEqual(r);
    expect(parseSiteMenu(r.items, 4)).toEqual(r);
  });

  test('depth beyond the field limit is refused with the line number', () => {
    expect(parseSiteMenu(OUTLINE, 2)).toEqual({
      ok: false,
      message: 'baris 4: submenu maksimal 2 tingkat',
    });
    expect(parseSiteMenu('A\n  B', 1).ok).toBe(false);
  });

  test('broken outlines and unsafe links are refused', () => {
    expect(parseSiteMenu('A\n    B', 4)).toEqual({
      ok: false,
      message: 'baris 2: submenu melompati tingkat di atasnya',
    });
    expect(parseSiteMenu('A\n B', 4)).toMatchObject({ ok: false });
    expect(parseSiteMenu('A -> javascript:alert(1)', 4)).toMatchObject({ ok: false });
    expect(parseSiteMenu('A -> //evil.example', 4)).toMatchObject({ ok: false });
    expect(parseSiteMenu(' | -> /x', 4)).toMatchObject({ ok: false });
  });

  test('plain-text items (top bar notices) and blank lines are fine', () => {
    expect(
      parseSiteMenu('Gratis ongkir | Free shipping\n\nBantuan -> mailto:cs@example.com', 1),
    ).toEqual({
      ok: true,
      items: [
        { label: { id: 'Gratis ongkir', en: 'Free shipping' }, href: null, children: [] },
        { label: { id: 'Bantuan', en: 'Bantuan' }, href: 'mailto:cs@example.com', children: [] },
      ],
    });
  });

  test('a stored value that cannot be read is an empty menu, not a crash', () => {
    expect(storedSiteMenu('[{"nope":1}]')).toEqual([]);
    expect(storedSiteMenu(null)).toEqual([]);
  });
});
