import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, newId, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): uploads (PRD Q-16) — validated by size and type (content sniffed),
 * stored through the adapter, under RBAC and tenancy: owner or `file.read` for private files,
 * anyone naming the tenant for public ones, `file.manage` to list/delete everything; delete removes
 * the object. Then the L-24 leftover: a public `theme-logo` becomes the custom theme's logo URL.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.71.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `files-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `files-member-${run}@example.test`;
const memberPassword = 'a regular member password';
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
]);

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
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
  if (init.body && typeof init.body === 'string' && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
const upload = (
  cookies: string[],
  file: { name: string; type: string; bytes: Uint8Array },
  fields: Record<string, string> = {},
  extra: Record<string, string> = {},
) => {
  const fd = new FormData();
  fd.set('file', new File([file.bytes], file.name, { type: file.type }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return call('/v1/files', { method: 'POST', body: fd }, cookies, extra);
};
type FileView = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: string;
  visibility: string;
  url: string;
};

describe.skipIf(!enabled)('uploads (Q-16): validation, storage, RBAC, tenancy, theme logo', () => {
  let db: Db;
  let tenantId = '';
  let admin = '';
  let member = '';
  let memberId = '';
  let privateId = '';
  let publicId = '';

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    const s = await runSeed(db, { adminEmail, adminPassword });
    tenantId = s.tenantId;
    admin = sessionCookie(
      await call('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      }),
    );
    const reg = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: memberEmail, password: memberPassword, name: 'Member' }),
    });
    expect(reg.status).toBe(201);
    member = sessionCookie(reg);
    memberId = (
      (await json(await call('/v1/auth/me', {}, [member]))).data as { user: { id: string } }
    ).user.id;
    // The member may upload (file.create) but not read others' private files or manage.
    const gid = newId();
    await db
      .insert(schema.groups)
      .values({ id: gid, client_id: tenantId, code: `up-${run}`.slice(0, 64), name: 'Uploaders' });
    await db
      .insert(schema.groupPermissions)
      .values({ id: newId(), client_id: tenantId, group_id: gid, permission: 'file.create' });
    await db
      .insert(schema.groupUserMaps)
      .values({ id: newId(), client_id: tenantId, group_id: gid, user_id: memberId });
  });

  test('a PNG uploads (201) with sniffed type, size and a content URL; anonymous is refused', async () => {
    expect((await upload([], { name: 'x.png', type: 'image/png', bytes: PNG })).status).toBe(401);
    const r = await upload([member], { name: 'logo.png', type: 'image/png', bytes: PNG });
    expect(r.status).toBe(201);
    const f = (await json(r)).data as FileView;
    privateId = f.id;
    expect(f.mime).toBe('image/png');
    expect(f.size).toBe(PNG.byteLength);
    expect(f.visibility).toBe('private');
    expect(f.url).toBe(`/v1/files/${f.id}/content`);
    const limits = (await json(await call('/v1/files/limits', {}, [member]))).data as {
      maxBytes: number;
      allowedTypes: string[];
    };
    expect(limits.maxBytes).toBe(10 * 1024 * 1024);
    expect(limits.allowedTypes).toContain('image/png');
  });

  test('type and content are enforced: disallowed type, spoofed PNG, oversize (tenant setting)', async () => {
    const exe = await upload([member], {
      name: 'run.exe',
      type: 'application/x-msdownload',
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0]),
    });
    expect(exe.status).toBe(422);
    expect((await json(exe)).error?.details?.reason).toBe('type_not_allowed');
    // Declared PNG, bytes are not: refused even though image/png is allowed.
    const fake = await upload([member], {
      name: 'fake.png',
      type: 'image/png',
      bytes: new TextEncoder().encode('<script>alert(1)</script>'),
    });
    expect(fake.status).toBe(422);
    expect((await json(fake)).error?.details?.reason).toBe('content_mismatch');
    // Tenant cap of 1 MB → a 1.5 MB PNG is refused with 413.
    await call(
      '/v1/configuration',
      {
        method: 'PUT',
        body: JSON.stringify({ scope: 'tenant', values: { 'files.max_size_mb': '1' } }),
      },
      [admin],
    );
    try {
      const big = new Uint8Array(1.5 * 1024 * 1024);
      big.set(PNG, 0);
      const r = await upload([member], { name: 'big.png', type: 'image/png', bytes: big });
      expect(r.status).toBe(413);
      expect((await json(r)).error?.details?.reason).toBe('too_large');
    } finally {
      await call(
        '/v1/configuration',
        {
          method: 'PUT',
          body: JSON.stringify({ scope: 'tenant', values: { 'files.max_size_mb': '' } }),
        },
        [admin],
      );
    }
  });

  test('private: owner and file.read holders read the bytes, others get 404; public: anonymous with the tenant', async () => {
    const own = await call(`/v1/files/${privateId}/content`, {}, [member]);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/png');
    expect(own.headers.get('content-disposition')).toContain('inline');
    expect(new Uint8Array(await own.arrayBuffer()).byteLength).toBe(PNG.byteLength);
    expect((await call(`/v1/files/${privateId}/content`)).status).toBe(404); // anonymous
    expect((await call(`/v1/files/${privateId}/content`, {}, [admin])).status).toBe(200); // superadmin = file.read

    const pub = await upload(
      [admin],
      { name: 'brand.png', type: 'image/png', bytes: PNG },
      { kind: 'theme-logo', visibility: 'public' },
    );
    expect(pub.status).toBe(201);
    publicId = ((await json(pub)).data as FileView).id;
    const anon = await call(`/v1/files/${publicId}/content`, {}, [], { 'x-client-id': tenantId });
    expect(anon.status).toBe(200);
    expect(anon.headers.get('cache-control')).toContain('public');
    // Another tenant cannot see it, even when public.
    const acme = newId();
    await db
      .insert(schema.clients)
      .values({ id: acme, code: `acme-f-${run}`.slice(0, 32), name: 'Acme' });
    expect(
      (await call(`/v1/files/${publicId}/content`, {}, [admin], { 'x-client-id': acme })).status,
    ).toBe(404);
  });

  test('SVG is served sandboxed; listing is mine unless file.manage; delete removes row and object', async () => {
    const svg = await upload([member], {
      name: 'v.svg',
      type: 'image/svg+xml',
      bytes: new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    });
    expect(svg.status).toBe(201);
    const svgId = ((await json(svg)).data as FileView).id;
    const served = await call(`/v1/files/${svgId}/content`, {}, [member]);
    expect(served.headers.get('content-security-policy')).toContain('sandbox');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');

    const mine = (await json(await call('/v1/files', {}, [member]))).data as FileView[];
    expect(mine.every((f) => [privateId, svgId].includes(f.id) || f.kind === 'generic')).toBe(true);
    expect(mine.some((f) => f.id === publicId)).toBe(false); // admin's file is not in the member's list
    const all = (await json(await call('/v1/files?all=1', {}, [admin]))).data as FileView[];
    expect(all.some((f) => f.id === publicId) && all.some((f) => f.id === privateId)).toBe(true);

    expect((await call(`/v1/files/${publicId}`, { method: 'DELETE' }, [member])).status).toBe(404); // not mine, no manage
    expect((await call(`/v1/files/${svgId}`, { method: 'DELETE' }, [member])).status).toBe(200);
    expect((await call(`/v1/files/${svgId}/content`, {}, [member])).status).toBe(404);
  });

  test('L-24 leftover: a public theme-logo becomes the custom theme’s logo URL in the manifest', async () => {
    const base = await Bun.file(
      new URL('../../../../packages/ui-theme/themes/base/tokens.css', import.meta.url),
    ).text();
    const { parseTokensCss } = await import('@core/ui-theme');
    const tokens = parseTokensCss(base);
    const created = await call(
      '/v1/themes/custom',
      {
        method: 'POST',
        body: JSON.stringify({
          slug: `logo-${run % 100000}`,
          name: { id: 'Berlogo', en: 'With logo' },
          base: 'base',
          icons: 'outline-24',
          layouts: {
            dashboard: { default: 'sidebar-classic' },
            public: { default: 'marketing-wide' },
            auth: { default: 'centered-card' },
          },
          tokens,
          assets: { logo: publicId },
        }),
      },
      [admin],
    );
    expect(created.status).toBe(201);
    const t = (await json(created)).data as {
      id: string;
      code: string;
      assets: { logo: string | null };
    };
    expect(t.assets.logo).toBe(publicId);
    const custom = (await json(await call('/v1/themes/custom', {}, [admin]))).data as {
      id: string;
      assets: { logo: string | null };
    }[];
    expect(custom.find((c) => c.id === t.code)?.assets.logo).toBe(`/v1/files/${publicId}/content`);
    // A malformed id is refused by the contract (422); a PUT that omits `assets` keeps the logo.
    const body = {
      slug: `logo-${run % 100000}`,
      name: { id: 'Berlogo', en: 'With logo' },
      base: 'base',
      icons: 'outline-24',
      layouts: {
        dashboard: { default: 'sidebar-classic' },
        public: { default: 'marketing-wide' },
        auth: { default: 'centered-card' },
      },
      tokens,
    };
    const bad = await call(
      `/v1/themes/custom/${t.id}`,
      { method: 'PUT', body: JSON.stringify({ ...body, assets: { logo: 'not-a-uuid' } }) },
      [admin],
    );
    expect(bad.status).toBe(422);
    const kept = await call(
      `/v1/themes/custom/${t.id}`,
      { method: 'PUT', body: JSON.stringify(body) },
      [admin],
    );
    expect(kept.status).toBe(200);
    expect(((await json(kept)).data as { assets: { logo: string | null } }).assets.logo).toBe(
      publicId,
    );
    // Explicit null clears it.
    const cleared = await call(
      `/v1/themes/custom/${t.id}`,
      { method: 'PUT', body: JSON.stringify({ ...body, assets: { logo: null } }) },
      [admin],
    );
    expect(
      ((await json(cleared)).data as { assets: { logo: string | null } }).assets.logo,
    ).toBeNull();
    await call(`/v1/themes/custom/${t.id}`, { method: 'DELETE' }, [admin]);
  });
});
