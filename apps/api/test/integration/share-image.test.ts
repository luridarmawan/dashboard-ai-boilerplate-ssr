import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { and, eq, isNull, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): `image` settings, with `app.share_image` (the site's default
 * og:image) as the example. The value is the id of a public raster file; saving refuses anything
 * else. Anonymous readers — social crawlers — get the URL and pixel size from
 * `GET /v1/configuration/image/:key` and the bytes from `/image-file/:id`, which serves ONLY a
 * file some image setting currently names. `storeUpload()` records the pixel size at upload.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'S'.repeat(43);
const run = Date.now();
const RUN_IP = `10.72.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `share-admin-${run}@example.test`;
const adminPassword = 'a share image admin password';
const KEY = 'app.share_image';

/** Just enough PNG for the sniffer and the size reader: signature + IHDR (width, height). */
const png = (width: number, height: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  b.set([8, 2, 0, 0, 0], 24);
  return b;
};

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; details?: Record<string, unknown> };
}
type Meta = { url: string; width: number | null; height: number | null; mime: string } | null;

let admin = '';
let tenantId = '';
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = async (r: Response) => (await r.json()) as Envelope;
const upload = async (bytes: Uint8Array, type: string, visibility = 'public') => {
  const fd = new FormData();
  fd.set('file', new File([bytes], `x-${run}`, { type }));
  fd.set('kind', 'setting-image');
  fd.set('visibility', visibility);
  const res = await call('/v1/files', { method: 'POST', body: fd }, [admin]);
  const body = await json(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return (body.data as { id: string }).id;
};
const save = (value: string, scope?: 'global') =>
  call(
    '/v1/configuration',
    {
      method: 'PUT',
      body: JSON.stringify({ ...(scope ? { scope } : {}), values: { [KEY]: value } }),
    },
    [admin],
  );
const meta = async (cookies: string[] = []) =>
  (await json(await call(`/v1/configuration/image/${KEY}`, {}, cookies))).data as Meta;
const bytesOf = (id: string) =>
  app.handle(new Request(`${ORIGIN}/v1/configuration/image-file/${id}`));

describe.skipIf(!enabled)('image settings: the default share image (og:image)', () => {
  let globalBefore: string | null = null;
  let tenantBefore: string | null = null;

  beforeAll(async () => {
    const s = await runSeed(unsafeAcrossTenants(), { adminEmail, adminPassword });
    tenantId = s.tenantId;
    const res = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    admin =
      res.headers
        .getSetCookie()
        .find((c) => c.startsWith('crk_session='))
        ?.split(';')[0] ?? '';
    const rows = await unsafeAcrossTenants()
      .select({ value: schema.configurations.value, client: schema.configurations.client_id })
      .from(schema.configurations)
      .where(eq(schema.configurations.key, KEY));
    globalBefore = rows.find((r) => r.client === null)?.value ?? null;
    tenantBefore = rows.find((r) => r.client === tenantId)?.value ?? null;
  });

  afterAll(async () => {
    await save(globalBefore ?? '', 'global');
    await save(tenantBefore ?? '');
  });

  test('a tenant value: saved, sized at upload, served to anonymous crawlers', async () => {
    const id = await upload(png(1200, 630), 'image/png');
    const [file] = await unsafeAcrossTenants()
      .select({ meta: schema.files.meta })
      .from(schema.files)
      .where(eq(schema.files.id, id));
    expect(file?.meta).toMatchObject({ width: 1200, height: 630 });

    expect((await save(id)).status).toBe(200);
    expect(await meta([admin])).toEqual({
      url: `/v1/configuration/image-file/${id}`,
      width: 1200,
      height: 630,
      mime: 'image/png',
    });
    const got = await bytesOf(id);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('cache-control')).toContain('public');

    // Removed from the setting → no longer served, even though the file still exists.
    expect((await save('')).status).toBe(200);
    expect(await meta([admin])).toBeNull();
    expect((await bytesOf(id)).status).toBe(404);
  });

  test('the global value is what an anonymous visitor reads', async () => {
    const id = await upload(png(1200, 630), 'image/png');
    expect((await save(id, 'global')).status).toBe(200);
    expect((await meta())?.url).toBe(`/v1/configuration/image-file/${id}`);
    expect((await bytesOf(id)).status).toBe(200);
  });

  test('only a public raster file of the right tenant is accepted', async () => {
    const random = '01a14839-be52-7132-aa3d-08be144878e1';
    const pdf = await upload(new TextEncoder().encode('%PDF-1.7\n%%EOF\n'), 'application/pdf');
    const hidden = await upload(png(100, 100), 'image/png', 'private');
    for (const value of [random, pdf, hidden, 'not-an-id']) {
      const res = await save(value);
      const body = await json(res);
      expect(res.status, value).toBe(422);
      expect(Object.keys(body.error?.details ?? {}), value).toEqual([KEY]);
    }
    // A file nobody's setting names is never served by the image route.
    const loose = await upload(png(10, 10), 'image/png');
    expect((await bytesOf(loose)).status).toBe(404);
    const [live] = await unsafeAcrossTenants()
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(and(eq(schema.files.id, loose), isNull(schema.files.deleted_at)));
    expect(live?.id).toBe(loose);
  });

  test('an unknown key is 404, and the setting is public in the public values', async () => {
    expect((await call('/v1/configuration/image/app.name')).status).toBe(404);
    const pub = (await json(await call('/v1/configuration/public'))).data as Record<
      string,
      unknown
    >;
    expect(KEY in pub).toBe(true);
  });
});
