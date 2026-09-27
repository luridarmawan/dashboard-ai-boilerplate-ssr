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
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
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
    .find((c) => c.startsWith('crk_session='))
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
      groups?: { key: string }[];
      fields: { key: string; type: string; group?: string; width?: string }[];
    }[];
    expect(sections.map((s) => s.section)).toEqual(
      expect.arrayContaining(['app', 'security', 'mail', 'ai', 'dummy']),
    );
    const app = sections.find((s) => s.section === 'app');
    expect(
      app?.fields.some((f) => f.key === 'app.landing_route' && f.type === 'public_route'),
    ).toBe(true);
    expect(app?.fields.some((f) => f.key === 'app.home_route' && f.type === 'route')).toBe(true);
    // F-11: the 404 handler is the third route setting, right below the home route, and it
    // picks from the same anonymous-reachable subset the landing page does (§4.7 rule 6).
    expect(
      app?.fields.some((f) => f.key === 'app.not_found_route' && f.type === 'not_found_route'),
    ).toBe(true);
    // …and the form is told which pages modules declared as handlers, with the module's name.
    expect(d(r).notFoundRoutes).toEqual(
      expect.arrayContaining([{ path: '/resolve', module: 'Example' }]),
    );
    // The Application tab is drawn in three groups (owner's ask of 2026-09-26): identity
    // (name | lead, logo | favicon), default handlers (three per row), theme & layout.
    expect(app?.groups?.map((g) => g.key)).toEqual(['identity', 'handlers', 'appearance']);
    const layout = (app?.fields ?? []).map((f) => `${f.key}:${f.group}:${f.width}`);
    expect(layout).toEqual([
      'app.name:identity:half',
      'app.landing_lead:identity:half',
      'app.logo_url:identity:half',
      'app.favicon_url:identity:half',
      'app.landing_route:handlers:third',
      'app.home_route:handlers:third',
      'app.not_found_route:handlers:third',
      'app.default_theme:appearance:third',
      'app.default_locale:appearance:third',
      'app.timezone:appearance:third',
      'app.allowed_themes:appearance:full',
    ]);
    expect(app?.fields.find((f) => f.key === 'app.favicon_url')?.type).toBe('string');
    expect((d(r).routes as string[]).includes('/dashboard')).toBe(true);
    // §4.7: the landing page picks from the anonymous-reachable subset only.
    const publicRoutes = d(r).publicRoutes as string[];
    expect(publicRoutes).toEqual(expect.arrayContaining(['/', '/auth/login']));
    expect(publicRoutes).not.toContain('/dashboard');
    expect(publicRoutes).not.toContain('/settings');
  });

  test('route values are validated against the route registry when saved (§4.7 rule 1)', async () => {
    // F-11: the 404 handler must be a DECLARED handler page — a landing page is refused even
    // though it is public, because it would answer every unknown URL with a 200.
    const notHandler = await put(
      '/v1/configuration',
      { scope: 'global', values: { 'app.not_found_route': '/example' } },
      [admin],
    );
    expect(notHandler.status).toBe(422);
    const handler = await put(
      '/v1/configuration',
      { scope: 'global', values: { 'app.not_found_route': '/resolve' } },
      [admin],
    );
    expect(handler.status).toBe(200);
    await put('/v1/configuration', { scope: 'global', values: { 'app.not_found_route': '' } }, [
      admin,
    ]);
    const bad = await put('/v1/configuration', { values: { 'app.home_route': '/m/ghost' } }, [
      admin,
    ]);
    expect(bad.status).toBe(422);
    expect(
      (((await json(bad)).error ?? {}) as { details?: Record<string, string> }).details?.[
        'app.home_route'
      ],
    ).toMatch(/registry route/);
    // The landing page is a `public_route`: a real page that needs a session is refused too.
    const behindLogin = await put(
      '/v1/configuration',
      { values: { 'app.landing_route': '/dashboard' } },
      [admin],
    );
    expect(behindLogin.status).toBe(422);
    expect(
      (((await json(behindLogin)).error ?? {}) as { details?: Record<string, string> }).details?.[
        'app.landing_route'
      ],
    ).toMatch(/halaman publik/);
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
    expect(pub.data?.['app.landing_route']).toBe('/');
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
      (await put('/v1/configuration', { values: { 'app.landing_route': '/theme' } }, [admin]))
        .status,
    ).toBe(200);
    const view = await json(await call('/v1/configuration', {}, [admin]));
    const field = (
      d(view).sections as { fields: { key: string; value: unknown; source: string }[] }[]
    )
      .flatMap((s) => s.fields)
      .find((f) => f.key === 'app.landing_route');
    expect(field?.value).toBe('/theme');
    expect(field?.source).toBe('tenant');
    // anonymous, no tenant → global
    const anon = await json(await call('/v1/configuration/public'));
    expect(anon.data?.['app.landing_route']).toBe('/auth/login');
    // clearing the tenant override falls back to global
    await put('/v1/configuration', { values: { 'app.landing_route': '' } }, [admin]);
    const back = await json(await call('/v1/configuration/key/app.landing_route', {}, [admin]));
    expect(back.data?.source).toBe('global');
    // Clear the global override too: the gate proofs run on this database after the suite, and a
    // leftover landing route turns `/` into a redirect (K-2 reads the language from that page).
    await put('/v1/configuration', { scope: 'global', values: { 'app.landing_route': '' } }, [
      admin,
    ]);
    const reset = await json(await call('/v1/configuration/key/app.landing_route', {}, [admin]));
    expect(reset.data?.source).not.toBe('global');
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

  test('G-8: disabling a module for the tenant refuses its routes and hides its menu and settings section; re-enable restores', async () => {
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
    // The Settings form drops the module's section too; core sections are unaffected.
    const sectionsOf = async () =>
      (
        d(await json(await call('/v1/configuration', {}, [admin]))).sections as {
          section: string;
        }[]
      ).map((s) => s.section);
    expect(await sectionsOf()).not.toContain('dummy');
    expect(await sectionsOf()).toEqual(expect.arrayContaining(['app', 'security', 'mail']));
    // …and its pages leave the route registry the `route` fields (landing, home) pick from —
    // both the public page and the dashboard page; core pages and other modules stay.
    const routesOf = async () =>
      d(await json(await call('/v1/configuration', {}, [admin]))).routes as string[];
    expect(await routesOf()).not.toContain('/hello-dummy');
    expect(await routesOf()).not.toContain('/m/dummy/notes');
    expect(await routesOf()).toEqual(expect.arrayContaining(['/dashboard', '/example']));
    // The landing page's own (public) list is narrowed by the same rule.
    const publicRoutesOf = async () =>
      d(await json(await call('/v1/configuration', {}, [admin]))).publicRoutes as string[];
    expect(await publicRoutesOf()).not.toContain('/hello-dummy');
    expect(await publicRoutesOf()).toContain('/example');
    // Saving such a route is refused as well: the list is the one the form was generated from.
    const refused = await put(
      '/v1/configuration',
      { values: { 'app.landing_route': '/hello-dummy' } },
      [admin],
    );
    expect(refused.status).toBe(422);
    const list = await json(await call('/v1/module', {}, [admin]));
    expect(
      (d(list) as unknown as { name: string; effective: boolean }[]).find((m) => m.name === 'Dummy')
        ?.effective,
    ).toBe(false);
    expect((await put('/v1/module/Dummy/enabled', { enabled: null }, [admin])).status).toBe(200); // drop override
    expect((await call('/v1/m/dummy/ping', {}, [admin])).status).toBe(200);
    expect(await sectionsOf()).toContain('dummy');
    expect(await routesOf()).toEqual(expect.arrayContaining(['/hello-dummy', '/m/dummy/notes']));
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
