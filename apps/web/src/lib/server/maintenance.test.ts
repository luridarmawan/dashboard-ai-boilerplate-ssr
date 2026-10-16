import { describe, expect, test } from 'bun:test';
import { isMaintenanceAllowed, maintenanceEnvFlag, resolveMaintenance } from './maintenance.ts';

const session = (active: boolean, source: 'env' | 'config' | null, exempt: boolean) => ({
  maintenance: { active, source, exempt },
});

describe('maintenance mode on the web (E-10)', () => {
  test('off: nothing is blocked and everyone counts as exempt', () => {
    const s = resolveMaintenance({
      pathname: '/dashboard',
      envFlag: false,
      configFlag: false,
      session: null,
    });
    expect(s).toEqual({ active: false, source: null, exempt: true, blocked: false });
  });

  test('Settings switch: anonymous visitors keep the public pages, signed-in non-admins do not', () => {
    const anon = resolveMaintenance({
      pathname: '/example',
      envFlag: false,
      configFlag: true,
      session: null,
    });
    expect(anon.active).toBe(true);
    expect(anon.source).toBe('config');
    expect(anon.blocked).toBe(false);
    const member = resolveMaintenance({
      pathname: '/example',
      envFlag: false,
      configFlag: true,
      session: session(true, 'config', false),
    });
    expect(member.blocked).toBe(true);
    const admin = resolveMaintenance({
      pathname: '/dashboard',
      envFlag: false,
      configFlag: true,
      session: session(true, 'config', true),
    });
    expect(admin.blocked).toBe(false);
    expect(admin.exempt).toBe(true);
  });

  test('the API verdict for a session counts even when the public value is missing', () => {
    // The public configuration failed to load (API down → defaults), but /me said maintenance.
    const s = resolveMaintenance({
      pathname: '/dashboard',
      envFlag: false,
      configFlag: undefined,
      session: session(true, 'config', false),
    });
    expect(s.active).toBe(true);
    expect(s.blocked).toBe(true);
  });

  test('.env switch: anonymous visitors are blocked too, the sign-in flow is not', () => {
    const page = resolveMaintenance({
      pathname: '/example',
      envFlag: true,
      configFlag: false,
      session: null,
    });
    expect(page).toEqual({ active: true, source: 'env', exempt: false, blocked: true });
    for (const p of ['/auth/login', '/auth/login?next=%2Fx', '/theme', '/lang', '/maintenance']) {
      const url = new URL(p, 'http://web.test');
      expect(
        resolveMaintenance({
          pathname: url.pathname,
          envFlag: true,
          configFlag: false,
          session: null,
        }).blocked,
        p,
      ).toBe(false);
    }
    const admin = resolveMaintenance({
      pathname: '/users',
      envFlag: true,
      configFlag: false,
      session: session(true, 'env', true),
    });
    expect(admin.blocked).toBe(false);
  });

  test('allow-list matches whole path segments', () => {
    expect(isMaintenanceAllowed('/auth/login')).toBe(true);
    expect(isMaintenanceAllowed('/auth/google/callback')).toBe(true);
    expect(isMaintenanceAllowed('/auth/logout')).toBe(true);
    expect(isMaintenanceAllowed('/_app/immutable/x.js')).toBe(true);
    expect(isMaintenanceAllowed('/auth/register')).toBe(false);
    expect(isMaintenanceAllowed('/auth/loginx')).toBe(false);
    expect(isMaintenanceAllowed('/themes')).toBe(false);
    expect(isMaintenanceAllowed('/dashboard')).toBe(false);
  });

  test('the environment flag is only ever the literal `true`', () => {
    expect(maintenanceEnvFlag({ MAINTENANCE_MODE: 'true' })).toBe(true);
    expect(maintenanceEnvFlag({ MAINTENANCE_MODE: ' true ' })).toBe(true);
    expect(maintenanceEnvFlag({ MAINTENANCE_MODE: '1' })).toBe(false);
    expect(maintenanceEnvFlag({ MAINTENANCE_MODE: 'false' })).toBe(false);
    expect(maintenanceEnvFlag({})).toBe(false);
  });
});
