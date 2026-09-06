import { describe, expect, test } from 'bun:test';
import type { ConfigFieldDef } from '@core/module-kit';
import { parseValue, validateValue } from '../src/validate.ts';

const f = (over: Partial<ConfigFieldDef>): ConfigFieldDef => ({
  key: 'x.y',
  type: 'string',
  title: { id: 'x', en: 'x' },
  ...over,
});
const routes = ['/', '/dashboard', '/m/example', '/auth/login'];

describe('configuration values are typed, not free strings (E-3)', () => {
  test('route must exist in the route registry (§4.7 rule 1)', () => {
    expect(validateValue(f({ type: 'route' }), '/m/example', { routes })).toEqual({
      ok: true,
      stored: '/m/example',
    });
    expect(validateValue(f({ type: 'route' }), '/m/ghost', { routes }).ok).toBe(false);
    expect(validateValue(f({ type: 'route' }), 'dashboard', { routes }).ok).toBe(false);
    expect(validateValue(f({ type: 'route' }), '/auth/login', { routes }).ok).toBe(true); // §4.7 rule 3
  });
  test('theme must be registered; select must be an option; locale must exist', () => {
    expect(validateValue(f({ type: 'theme' }), 'corporate').ok).toBe(true);
    expect(validateValue(f({ type: 'theme' }), 'neon').ok).toBe(false);
    expect(
      validateValue(
        f({ type: 'select', options: [{ value: 'a', label: { id: 'a', en: 'a' } }] }),
        'b',
      ).ok,
    ).toBe(false);
    expect(validateValue(f({ type: 'locale' }), 'fr').ok).toBe(false);
  });
  test('numbers respect bounds and booleans normalise', () => {
    expect(validateValue(f({ type: 'number', min: 1, max: 10 }), '11').ok).toBe(false);
    expect(validateValue(f({ type: 'number', min: 1 }), '3')).toEqual({ ok: true, stored: '3' });
    expect(validateValue(f({ type: 'boolean' }), 'on')).toEqual({ ok: true, stored: 'true' });
    expect(validateValue(f({ type: 'boolean' }), 'maybe').ok).toBe(false);
  });
  test('lists store JSON and parse back; empty clears the override', () => {
    expect(validateValue(f({ type: 'list' }), 'base, warm')).toEqual({
      ok: true,
      stored: '["base","warm"]',
    });
    expect(validateValue(f({ type: 'list' }), '')).toEqual({ ok: true, stored: null });
    expect(parseValue(f({ type: 'list' }), '["a","b"]')).toEqual(['a', 'b']);
    expect(parseValue(f({ type: 'list', default: ['z'] }), null)).toEqual(['z']);
  });
  test('defaults apply when nothing is stored', () => {
    expect(parseValue(f({ type: 'number', default: 7 }), null)).toBe(7);
    expect(parseValue(f({ type: 'boolean', default: true }), null)).toBe(true);
    expect(parseValue(f({ type: 'string' }), null)).toBeNull();
  });
});
