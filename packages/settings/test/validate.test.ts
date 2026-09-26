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
    expect(validateValue(f({ type: 'route' }), '/auth/login', { routes }).ok).toBe(true); // §4.7 rule 4
  });
  test('not_found_route accepts only a declared 404 handler page (F-11)', () => {
    const ctx = {
      routes,
      publicRoutes: ['/', '/example', '/resolve'],
      notFoundRoutes: ['/resolve'],
    };
    expect(validateValue(f({ type: 'not_found_route' }), '/resolve', ctx)).toEqual({
      ok: true,
      stored: '/resolve',
    });
    // A landing page is public, but it is not a handler: it would answer every unknown URL with 200.
    expect(validateValue(f({ type: 'not_found_route' }), '/example', ctx).ok).toBe(false);
    expect(validateValue(f({ type: 'not_found_route' }), '', ctx)).toEqual({
      ok: true,
      stored: null,
    });
  });

  test('public_route accepts only the anonymous-reachable subset (§4.7)', () => {
    const ctx = { routes, publicRoutes: ['/', '/auth/login', '/example'] };
    expect(validateValue(f({ type: 'public_route' }), '/example', ctx)).toEqual({
      ok: true,
      stored: '/example',
    });
    expect(validateValue(f({ type: 'public_route' }), '/auth/login', ctx).ok).toBe(true); // §4.7 rule 4
    // in the full registry, but behind the sign-in wall — a landing page it cannot be
    expect(validateValue(f({ type: 'public_route' }), '/dashboard', ctx).ok).toBe(false);
    expect(validateValue(f({ type: 'route' }), '/dashboard', ctx).ok).toBe(true);
    // clearing it still falls back to LANDING_ROUTE
    expect(validateValue(f({ type: 'public_route' }), '', ctx)).toEqual({ ok: true, stored: null });
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
  test('timezone must be a zone Intl knows; empty means "inherit"', () => {
    expect(validateValue(f({ type: 'timezone' }), 'Asia/Jakarta')).toEqual({
      ok: true,
      stored: 'Asia/Jakarta',
    });
    expect(validateValue(f({ type: 'timezone' }), ' UTC ')).toEqual({ ok: true, stored: 'UTC' });
    expect(validateValue(f({ type: 'timezone' }), 'Mars/Olympus').ok).toBe(false);
    expect(validateValue(f({ type: 'timezone' }), 'WIB').ok).toBe(false);
    // Nothing typed is not an error: the value falls back to global, then to the server's zone.
    expect(validateValue(f({ type: 'timezone' }), '')).toEqual({ ok: true, stored: null });
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
