import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, newId, schema, unsafeAcrossTenants } from '@core/db';
import { parseTokensCss } from '@core/ui-theme';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): admin-assembled themes (PRD L-24) against a real database —
 *   - a theme built from valid tokens is saved and immediately part of the tenant's registry
 *     (`GET /v1/themes`, `GET /v1/themes/custom` with CSS), usable as a user's choice and as the
 *     tenant default;
 *   - a theme that fails WCAG AA (L-21), names an unregistered icon set (L-5) or layout (L-8) is
 *     refused with the exact problems, never stored;
 *   - tenants do not see each other's themes; global themes are superadmin-only and visible to all;
 *   - deleting a theme in use makes the resolution chain fall back (no error).
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.73.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `theme-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `theme-member-${run}@example.test`;
const memberPassword = 'a regular member password';
const SLUG = `laut-${run % 100000}`;

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; details?: Record<string, unknown> };
}
const call = (
  path: string,
  init: RequestInit = {},
  cookies: string[] = [],
  extra: Record<string, string> = {},
) => {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
const post = (
  path: string,
  body: unknown,
  cookies: string[] = [],
  extra: Record<string, string> = {},
) => call(path, { method: 'POST', body: JSON.stringify(body) }, cookies, extra);
const put = (path: string, body: unknown, cookies: string[] = []) =>
  call(path, { method: 'PUT', body: JSON.stringify(body) }, cookies);
/** `error.details` of a failed envelope, typed for the contract checks. */
const details = async (r: Response) =>
  ((await json(r)).error?.details ?? {}) as {
    errors?: Record<string, string>;
    contrast?: { fg: string; bg: string; mode: string; ratio: number }[];
  };

const baseTokens = parseTokensCss(
  await Bun.file(
    new URL('../../../../packages/ui-theme/themes/base/tokens.css', import.meta.url),
  ).text(),
);
const validBody = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  name: { id: 'Laut', en: 'Sea' },
  description: { id: 'Biru laut', en: 'Sea blue' },
  base: 'base',
  icons: 'solid-24',
  layouts: {
    dashboard: { default: 'topnav-compact', wide: 'topnav-compact' },
    public: { default: 'marketing-wide' },
    auth: { default: 'split-hero' },
  },
  tokens: {
    light: { ...baseTokens.light, primary: '#0e6e8e', ring: '#0e6e8e', 'chart-1': '#0e6e8e' },
    dark: { ...baseTokens.dark },
  },
  ...extra,
});

describe.skipIf(!enabled)('custom themes (L-24, L-21, L-5, L-8)', () => {
  let db: Db;
  let tenantId = '';
  let acmeId = '';
  let admin = '';
  let member = '';
  let themeId = '';

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    const s = await runSeed(db, { adminEmail, adminPassword });
    tenantId = s.tenantId;
    admin = sessionCookie(
      await post('/v1/auth/login', { email: adminEmail, password: adminPassword }),
    );
    const reg = await post('/v1/auth/register', {
      email: memberEmail,
      password: memberPassword,
      name: 'Member',
    });
    expect(reg.status).toBe(201);
    member = sessionCookie(reg);
    acmeId = newId();
    await db
      .insert(schema.clients)
      .values({ id: acmeId, code: `acme-th-${run}`.slice(0, 32), name: 'Acme' });
  });

  test('a valid theme is created, listed with CSS, and usable as choice and default; a member may not manage', async () => {
    expect((await post('/v1/themes/custom', validBody(SLUG), [member])).status).toBe(403);
    const created = await post('/v1/themes/custom', validBody(SLUG), [admin]);
    expect(created.status).toBe(201);
    const c = (await json(created)).data as {
      id: string;
      code: string;
      scope: string;
      tokens: { light: Record<string, string> };
    };
    themeId = c.id;
    expect(c.code).toBe(`custom.${SLUG}`);
    expect(c.scope).toBe(tenantId);
    expect(c.tokens.light.primary).toBe('#0e6e8e');

    // Registry for the tenant now carries it. Tenant-scoped rows need the tenant context: an
    // anonymous request (no session, no X-Client-ID) only sees global rows — same rule as
    // `configuration/public`.
    const reg = (await json(await call('/v1/themes', {}, [admin]))).data as {
      themes: { id: string; custom: boolean; icons: string }[];
    };
    const mine = reg.themes.find((t) => t.id === `custom.${SLUG}`);
    expect(mine?.custom).toBe(true);
    expect(mine?.icons).toBe('solid-24');
    expect(reg.themes.find((t) => t.id === 'base')?.custom).toBe(false);
    const custom = (await json(await call('/v1/themes/custom', {}, [member]))).data as {
      id: string;
      css: string;
    }[];
    const css = custom.find((t) => t.id === `custom.${SLUG}`)?.css ?? '';
    expect(css).toContain(`[data-app-theme="custom.${SLUG}"]`);
    expect(css).toContain('--primary: #0e6e8e;');
    expect(css).toContain('[data-mode="dark"]');

    // A user may pick it; an admin may make it the tenant default; settings validation accepts it.
    expect((await put('/v1/themes/me', { theme: `custom.${SLUG}` }, [member])).status).toBe(200);
    expect((await put('/v1/themes/default', { theme: `custom.${SLUG}` }, [admin])).status).toBe(
      200,
    );
    const cfg = (await json(await call('/v1/configuration/public', {}, [member]))).data as Record<
      string,
      unknown
    >;
    expect(cfg['app.default_theme']).toBe(`custom.${SLUG}`);
    // The settings form offers it as an option too.
    const form = (await json(await call('/v1/configuration', {}, [admin]))).data as {
      sections: { fields: { key: string; options: { value: string }[] | null }[] }[];
    };
    const field = form.sections.flatMap((s) => s.fields).find((f) => f.key === 'app.default_theme');
    expect(field?.options?.some((o) => o.value === `custom.${SLUG}`)).toBe(true);
    await put('/v1/themes/default', { theme: 'base' }, [admin]);
  });

  test('the contract gates every save: AA contrast, registered icon set, registered layout of the right kind, duplicate slug', async () => {
    const lowContrast = validBody(`${SLUG}-2`, {
      tokens: { light: { ...baseTokens.light, foreground: '#cccccc' }, dark: baseTokens.dark },
    });
    const r1 = await post('/v1/themes/custom', lowContrast, [admin]);
    expect(r1.status).toBe(422);
    const d1 = await details(r1);
    expect(
      d1.contrast?.some(
        (p) => p.fg === 'foreground' && p.bg === 'background' && p.mode === 'light',
      ),
    ).toBe(true);
    expect(d1.contrast?.[0]?.ratio).toBeLessThan(4.5);

    const badIcons = await post('/v1/themes/custom', validBody(`${SLUG}-3`, { icons: 'nope-24' }), [
      admin,
    ]);
    expect(badIcons.status).toBe(422);
    expect((await details(badIcons)).errors?.icons).toContain('L-5');

    const wrongKind = await post(
      '/v1/themes/custom',
      validBody(`${SLUG}-4`, {
        layouts: {
          dashboard: { default: 'centered-card' },
          public: { default: 'marketing-wide' },
          auth: { default: 'centered-card' },
        },
      }),
      [admin],
    );
    expect(wrongKind.status).toBe(422);
    expect((await details(wrongKind)).errors?.['layouts.dashboard']).toContain(
      'bukan untuk dashboard',
    );

    const missingDefault = await post(
      '/v1/themes/custom',
      validBody(`${SLUG}-5`, {
        layouts: {
          dashboard: { wide: 'topnav-compact' },
          public: { default: 'marketing-wide' },
          auth: { default: 'centered-card' },
        },
      }),
      [admin],
    );
    expect(missingDefault.status).toBe(422);

    expect((await post('/v1/themes/custom', validBody(SLUG), [admin])).status).toBe(409);
    // Nothing of the rejected attempts was stored (the shared dev DB keeps rows from earlier runs,
    // so only this run's slugs are inspected).
    const mine = (await json(await call('/v1/themes/custom/mine', {}, [admin]))).data as {
      themes: { code: string }[];
    };
    expect(mine.themes.map((t) => t.code).filter((c) => c.startsWith(`custom.${SLUG}`))).toEqual([
      `custom.${SLUG}`,
    ]);
  });

  test('tenancy: another tenant does not see it; global themes need superadmin and reach every tenant', async () => {
    const acmeReg = (await json(await call('/v1/themes', {}, [admin], { 'x-client-id': acmeId })))
      .data as { themes: { id: string }[] };
    expect(acmeReg.themes.some((t) => t.id === `custom.${SLUG}`)).toBe(false);

    expect(
      (
        await post('/v1/themes/custom', validBody(`global-${run % 100000}`, { scope: 'global' }), [
          member,
        ])
      ).status,
    ).toBe(403);
    const g = await post(
      '/v1/themes/custom',
      validBody(`global-${run % 100000}`, { scope: 'global' }),
      [admin],
    );
    expect(g.status).toBe(201);
    const gid = ((await json(g)).data as { id: string }).id;
    const acmeAfter = (await json(await call('/v1/themes', {}, [admin], { 'x-client-id': acmeId })))
      .data as { themes: { id: string }[] };
    expect(acmeAfter.themes.some((t) => t.id === `custom.global-${run % 100000}`)).toBe(true);
    expect((await call(`/v1/themes/custom/${gid}`, { method: 'DELETE' }, [admin])).status).toBe(
      200,
    );
  });

  test('update re-validates and goes live; delete makes users fall back through the chain', async () => {
    const upd = await put(
      `/v1/themes/custom/${themeId}`,
      validBody(SLUG, { name: { id: 'Laut dalam', en: 'Deep sea' }, icons: 'bold-24' }),
      [admin],
    );
    expect(upd.status).toBe(200);
    const reg = (await json(await call('/v1/themes', {}, [admin]))).data as {
      themes: { id: string; icons: string; name: { id: string } }[];
    };
    const mine = reg.themes.find((t) => t.id === `custom.${SLUG}`);
    expect(mine?.icons).toBe('bold-24');
    expect(mine?.name.id).toBe('Laut dalam');

    const badUpd = await put(
      `/v1/themes/custom/${themeId}`,
      validBody(SLUG, {
        tokens: { light: { ...baseTokens.light, input: '#f0f0f0' }, dark: baseTokens.dark },
      }),
      [admin],
    );
    expect(badUpd.status).toBe(422); // --input on --background must be ≥ 3:1

    expect((await call(`/v1/themes/custom/${themeId}`, { method: 'DELETE' }, [admin])).status).toBe(
      200,
    );
    expect((await call(`/v1/themes/custom/${themeId}`, {}, [admin])).status).toBe(404);
    const after = (await json(await call('/v1/themes', {}, [admin]))).data as {
      themes: { id: string }[];
    };
    expect(after.themes.some((t) => t.id === `custom.${SLUG}`)).toBe(false);
    // The member still points at the deleted theme in their profile; the web resolver skips
    // unknown ids (L-12) — the API side simply no longer offers it, and choosing it again is refused.
    expect((await put('/v1/themes/me', { theme: `custom.${SLUG}` }, [member])).status).toBe(422);
  });
});
