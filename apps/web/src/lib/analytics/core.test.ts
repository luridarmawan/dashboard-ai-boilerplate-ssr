import { describe, expect, test } from 'bun:test';
import { type AnalyticsConfig, areaOf, isTracked, readCookie, trackedPath } from './core.ts';

const config: AnalyticsConfig = {
  provider: 'google',
  id: 'G-TEST1234',
  trackPublic: true,
  trackDashboard: false,
  requireConsent: true,
};

describe('analytics paths', () => {
  test('dashboard pages report their route pattern, never ids', () => {
    expect(trackedPath('/(app)/users/[id]', '/users/0192f3a1-0000-7000-8000-000000000000')).toBe(
      '/users/[id]',
    );
    expect(trackedPath('/(app)/m/example/items/[id]/edit', '/m/example/items/abc/edit')).toBe(
      '/m/example/items/[id]/edit',
    );
    expect(trackedPath('/(app)/dashboard', '/dashboard')).toBe('/dashboard');
  });

  test('tokens in auth and invitation links stay in the browser', () => {
    expect(trackedPath('/join/[token]', '/join/secret-token')).toBe('/join/[token]');
    expect(trackedPath('/auth/login', '/auth/login')).toBe('/auth/login');
  });

  test('public site pages report the real path', () => {
    expect(trackedPath('/(public)', '/')).toBe('/');
    expect(trackedPath('/(public)/(modules)/example', '/example')).toBe('/example');
    expect(trackedPath(null, '/furniture/chair')).toBe('/furniture/chair');
  });

  test('area follows the (app) route group', () => {
    expect(areaOf('/(app)/settings')).toBe('dashboard');
    expect(areaOf('/(app)')).toBe('dashboard');
    expect(areaOf('/(public)/(modules)/example')).toBe('public');
    expect(areaOf('/auth/login')).toBe('public');
    expect(areaOf('/(application)/x')).toBe('public');
    expect(areaOf(null)).toBe('public');
    expect(isTracked(config, 'public')).toBe(true);
    expect(isTracked(config, 'dashboard')).toBe(false);
  });

  test('cookies are read by exact name', () => {
    const jar = 'crk_consent_x=1; crk_consent=granted; other=a%20b';
    expect(readCookie(jar, 'crk_consent')).toBe('granted');
    expect(readCookie(jar, 'other')).toBe('a b');
    expect(readCookie(jar, 'missing')).toBeNull();
  });
});
