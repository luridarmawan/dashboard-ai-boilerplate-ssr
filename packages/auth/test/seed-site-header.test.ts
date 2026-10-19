import { describe, expect, test } from 'bun:test';
import { configFields, parseValue, validateValue } from '@core/settings';
import { SEED_TOPBAR_END } from '../src/seed-all.ts';

describe('first-seed site header example', () => {
  test('is a valid value for site.topbar_end, with the WhatsApp item', () => {
    const field = configFields().get('site.topbar_end');
    if (!field) throw new Error('site.topbar_end is not registered');
    const r = validateValue(field, SEED_TOPBAR_END);
    if (!r.ok) throw new Error(r.message);
    expect(parseValue(field, r.stored)).toEqual([
      { label: { id: 'Bantuan', en: 'Help' }, href: 'mailto:support@example.com', children: [] },
      {
        label: { id: '[wa] +62-812-3456-7890', en: '[wa] +62-812-3456-7890' },
        href: 'https://wa.me/6281234567890',
        children: [],
      },
    ]);
  });
});
