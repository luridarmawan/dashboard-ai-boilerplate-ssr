import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, unsafeAcrossTenants } from '@core/db';
import { SettingsStore } from '@core/settings';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): runtime configuration and module state against a real database —
 * M3 gate #1 pieces: typed validation (E-3), tenant → global → default (E-2), secrets masked
 * (E-4), the versioned cache converging across instances (E-5), module disable (G-8).
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.78.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `cfg-admin-${run}@example.test`;
const adminPassword = 'a config admin password';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; details?: unknown };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
/** Envelope data as a loose record — the tests below cast per field. */
const d = (r: Envelope) => (r.data ?? {}) as Record<string, unknown>;
const put = (path: string, body: unknown, cookies: string[]) =>
  call(path, { method: 'PUT', body: JSON.stringify(body) }, cookies);
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';

describe.skipIf(!enabled)('configuration & modules (E-1…E-5, G-8)', () => {
  let db: Db;
  let admin = '';
  let tenantId = '';

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants(); // only when the suite actually runs (INTEGRATION=1)
    const s = await runSeed(db, { adminEmail, adminPassword });
    tenantId = s.tenantId;
    const res = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(res.status).toBe(200);
    admin = sessionCookie(res);
    // Clean slate for the keys this suite touches (other proofs may have set them).
    await put(
      '/v1/configuration',
      {
        scope: 'global',
        values: {
          'app.landing_route': '',
          'app.default_theme': '',
          'dummy.greeting': '',
          'dummy.api_key': '__clear__',
        },
      },
      [admin],
    );
    await put('/v1/configuration', { values: { 'app.landing_route': '', 'dummy.greeting': '' } }, [
      admin,
    ]);
  });

  test('GET / generates the form: core sections + the Dummy module section (E-3, extension point 6)', async () => {
    const r = await json(await call('/v1/configuration', {}, [admin]));
    const sections = r.data?.sections as {
      section: string;
      fields: { key: string; type: string }[];
    }[];
    expect(sections.map((s) => s.section)).toEqual(
      expect.arrayContaining(['app', 'security', 'mail', 'ai', 'dummy']),
    );
    const app = sections.find((s) => s.section === 'app');
    expect(app?.fields.some((f) => f.key === 'app.landing_route' && f.type === 'route')).toBe(true);
    expect((d(r).routes as string[]).includes('/dashboard')).toBe(true);
  });

  test('route values are validated against the route registry when saved (§4.7 rule 1)', async () => {
    const bad = await put('/v1/configuration', { values: { 'app.landing_route': '/m/ghost' } }, [
      admin,
    ]);
    expect(bad.status).toBe(422);
    expect(
      (((await json(bad)).error ?? {}) as { details?: Record<string, string> }).details?.[
        'app.landing_route'
      ],
    ).toMatch(/registry route/);
    const badTheme = await put('/v1/configuration', { values: { 'app.default_theme': 'neon' } }, [
      admin,
    ]);
    expect(badTheme.status).toBe(422);
    const unknown = await put('/v1/configuration', { values: { 'nope.key': 'x' } }, [admin]);
    expect(unknown.status).toBe(422);
  });

  test('tenant overrides global, global overrides default; public values are readable anonymously (E-2, E-4)', async () => {
    // default
    let pub = await json(
      await call('/v1/configuration/public', { headers: { 'x-client-id': tenantId } }, [admin]),
    );
    expect(pub.data?.['app.landing_route']).toBe('/example');
    // global
    expect(
      (
        await put(
          '/v1/configuration',
          { scope: 'global', values: { 'app.landing_route': '/auth/login' } },
          [admin],
        )
      ).status,
    ).toBe(200);
    pub = await json(await call('/v1/configuration/public', {}, [admin]));
    expect(pub.data?.['app.landing_route']).toBe('/auth/login');
    // tenant
    expect(
      (await put('/v1/configuration', { values: { 'app.landing_route': '/dashboard' } }, [admin]))
        .status,
    ).toBe(200);
    const view = await json(await call('/v1/configuration', {}, [admin]));
    const field = (
      d(view).sections as { fields: { key: string; value: unknown; source: string }[] }[]
    )
      .flatMap((s) => s.fields)
      .find((f) => f.key === 'app.landing_route');
    expect(field?.value).toBe('/dashboard');
    expect(field?.source).toBe('tenant');
    // anonymous, no tenant → global
    const anon = await json(await call('/v1/configuration/public'));
    expect(anon.data?.['app.landing_route']).toBe('/auth/login');
    // clearing the tenant override falls back to global
    await put('/v1/configuration', { values: { 'app.landing_route': '' } }, [admin]);
    const back = await json(await call('/v1/configuration/key/app.landing_route', {}, [admin]));
    expect(back.data?.source).toBe('global');
  });

  test('secrets never leave in the clear: only "set" is reported; empty submit keeps it (E-4)', async () => {
    expect(
      (
        await put(
          '/v1/configuration',
          { scope: 'global', values: { 'dummy.api_key': 'sk-very-secret' } },
          [admin],
        )
      ).status,
    ).toBe(200);
    const view = await json(await call('/v1/configuration?scope=global', {}, [admin]));
    const f = (
      d(view).sections as {
        fields: { key: string; value: unknown; secretSet: boolean | null }[];
      }[]
    )
      .flatMap((s) => s.fields)
      .find((x) => x.key === 'dummy.api_key');
    expect(f?.value).toBeNull();
    expect(f?.secretSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('sk-very-secret');
    const pub = await json(await call('/v1/configuration/public'));
    expect('dummy.api_key' in (pub.data ?? {})).toBe(false);
    await put('/v1/configuration', { scope: 'global', values: { 'dummy.api_key': '' } }, [admin]); // keep
    expect(
      (await json(await call('/v1/configuration/key/dummy.api_key', {}, [admin]))).data?.secretSet,
    ).toBe(true);
  });

  test('E-5: a second store instance sees a save without restart (versioned database cache)', async () => {
    const a = new SettingsStore(db);
    const b = new SettingsStore(db);
    await a.resolveAll(null);
    await b.resolveAll(null); // both now hold a memory copy
    const r = await a.save(null, [{ key: 'dummy.greeting', value: `hello ${run}` }]);
    expect(r.changed.map((c) => c.key)).toEqual(['dummy.greeting']);
    expect(await b.get(null, 'dummy.greeting')).toBe(`hello ${run}`);
  });

  test('G-8: disabling a module for the tenant refuses its routes and hides its menu; re-enable restores', async () => {
    expect((await call('/v1/m/dummy/ping', {}, [admin])).status).toBe(200);
    const off = await put('/v1/module/Dummy/enabled', { enabled: false }, [admin]);
    expect(off.status).toBe(200);
    const blocked = await call('/v1/m/dummy/ping', {}, [admin]);
    expect(blocked.status).toBe(403);
    expect((await json(blocked)).error?.code).toBe('module_disabled');
    const menu = await json(await call('/v1/menu', {}, [admin]));
    expect((d(menu) as unknown as { id: string }[]).some((m) => m.id.startsWith('dummy.'))).toBe(
      false,
    );
    const list = await json(await call('/v1/module', {}, [admin]));
    expect(
      (d(list) as unknown as { name: string; effective: boolean }[]).find((m) => m.name === 'Dummy')
        ?.effective,
    ).toBe(false);
    expect((await put('/v1/module/Dummy/enabled', { enabled: null }, [admin])).status).toBe(200); // drop override
    expect((await call('/v1/m/dummy/ping', {}, [admin])).status).toBe(200);
  });

  test('themes: default and allowlist come from configuration (L-10, L-11)', async () => {
    expect((await put('/v1/themes/default', { theme: 'corporate' }, [admin])).status).toBe(200);
    const reg = await json(await call('/v1/themes', {}, [admin]));
    expect(reg.data?.default).toBe('corporate');
    expect(
      (
        await put(
          '/v1/configuration',
          { values: { 'app.allowed_themes': ['base', 'corporate'] } },
          [admin],
        )
      ).status,
    ).toBe(200);
    const filtered = await json(await call('/v1/themes', {}, [admin]));
    expect((d(filtered).themes as { id: string }[]).map((t) => t.id).sort()).toEqual([
      'base',
      'corporate',
    ]);
    const me = await put('/v1/themes/me', { theme: 'warm' }, [admin]);
    expect(me.status).toBe(422); // outside the allowlist
    await put(
      '/v1/configuration',
      { values: { 'app.allowed_themes': [], 'app.default_theme': '' } },
      [admin],
    );
  });
});
