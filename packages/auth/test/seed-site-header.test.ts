import { describe, expect, test } from 'bun:test';
import { configFields, parseValue, validateValue } from '@core/settings';
import { SEED_MENUBAR, SEED_TOPBAR, SEED_TOPBAR_END } from '../src/seed-all.ts';

/** The stored form of a seed value, validated exactly as a Settings form save would be. */
function stored(key: string, value: string): unknown {
  const field = configFields().get(key);
  if (!field) throw new Error(`${key} is not registered`);
  const r = validateValue(field, value);
  if (!r.ok) throw new Error(`${key}: ${r.message}`);
  return parseValue(field, r.stored);
}
const item = (label: string, href: string | null, children: unknown[] = []) => ({
  label: { id: label, en: label },
  href,
  children,
});

describe('first-seed site header example', () => {
  test('top bar, left: two links into the Example storefront', () => {
    expect(stored('site.topbar', SEED_TOPBAR)).toEqual([
      item('Kopi Super', '/example'),
      item('Contact Us', '/example#contact'),
    ]);
  });

  test('top bar, right: help and the WhatsApp item', () => {
    expect(stored('site.topbar_end', SEED_TOPBAR_END)).toEqual([
      { label: { id: 'Bantuan', en: 'Help' }, href: 'mailto:support@example.com', children: [] },
      item('[wa] +62-812-3456-7890', 'https://wa.me/6281234567890'),
    ]);
  });

  test('menu bar: a submenu of products between two plain links', () => {
    expect(stored('site.menubar', SEED_MENUBAR)).toEqual([
      item('Home', '/'),
      item('My Product', null, [
        item('Gayo Arabika', '/product/gayo-arabika'),
        item('Toraja Sapan', '/product/toraja-sapan'),
        item('Kintamani Natural', '/product/kintamani-natural'),
      ]),
      item('Custom Theme', '/theme'),
    ]);
  });
});
