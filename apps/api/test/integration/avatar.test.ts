import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, newId, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): user avatars (D-4 + Q-16). Any signed-in user uploads through the
 * file service (images only, 2 MB); the URL lands on the user row; the file is public and USER-
 * global — readable from another tenant, where a normal public file would be 404; replacing or
 * removing deletes the previous upload; an external URL set through the profile form is left alone.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.85.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `avatar-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `avatar-member-${run}@example.test`;
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
const uploadAvatar = (
  cookies: string[],
  bytes: Uint8Array,
  name = 'me.png',
  type = 'image/png',
) => {
  const fd = new FormData();
  fd.set('file', new File([bytes], name, { type }));
  return call('/v1/users/profile/avatar', { method: 'PUT', body: fd }, cookies);
};
const avatarUrlOf = async (cookies: string[]) =>
  (
    (await json(await call('/v1/auth/me', {}, cookies))).data as {
      user: { avatarUrl: string | null };
    }
  ).user.avatarUrl;

describe.skipIf(!enabled)(
  'user avatar (D-4, Q-16): upload, user-global read, replace, remove',
  () => {
    let db: Db;
    let tenantId = '';
    let member = '';
    let acmeId = '';

    beforeAll(async () => {
      if (!enabled) return;
      db = unsafeAcrossTenants();
      process.env.SIGNUP_ENABLED = 'true';
      const s = await runSeed(db, { adminEmail, adminPassword });
      tenantId = s.tenantId;
      const reg = await call('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: memberEmail, password: memberPassword, name: 'Ava Tar' }),
      });
      expect(reg.status).toBe(201);
      member = sessionCookie(reg);
      acmeId = newId();
      await db
        .insert(schema.clients)
        .values({ id: acmeId, code: `acme-av-${run}`.slice(0, 32), name: 'Acme' });
    });

    test('any signed-in user uploads (no file.create needed); anonymous 401; the URL is on /me', async () => {
      expect((await uploadAvatar([], PNG)).status).toBe(401);
      const r = await uploadAvatar([member], PNG);
      expect(r.status).toBe(200);
      const url = ((await json(r)).data as { user: { avatarUrl: string } }).user.avatarUrl;
      expect(url).toMatch(/^\/v1\/files\/[0-9a-f-]{36}\/content$/);
      expect(await avatarUrlOf([member])).toBe(url);
      const img = await call(url, {}, [member]);
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/png');
      expect(img.headers.get('cache-control')).toContain('public');
    });

    test('type and size are enforced independently of the tenant allowlist', async () => {
      const pdf = await uploadAvatar(
        [member],
        new TextEncoder().encode('%PDF-1.7\n'),
        'cv.pdf',
        'application/pdf',
      );
      expect(pdf.status).toBe(422);
      expect((await json(pdf)).error?.details?.reason).toBe('type_not_allowed');
      const big = new Uint8Array(2 * 1024 * 1024 + 1);
      big.set(PNG, 0);
      const r = await uploadAvatar([member], big);
      expect(r.status).toBe(413);
      expect((await json(r)).error?.details?.reason).toBe('too_large');
    });

    test('user-global: readable from another tenant and with no tenant at all, unlike an ordinary public file', async () => {
      const url = (await avatarUrlOf([member])) as string;
      // Anonymous may name any tenant (a member of only the home tenant would get 403 for acme itself).
      expect((await call(url, {}, [], { 'x-client-id': acmeId })).status).toBe(200);
      expect((await call(url)).status).toBe(200); // anonymous, no tenant header
      const meta = (
        await json(await call(url.replace(/\/content$/, ''), {}, [], { 'x-client-id': acmeId }))
      ).data as { kind: string; visibility: string };
      expect(meta.kind).toBe('avatar');
      expect(meta.visibility).toBe('public');
      // The ordinary tenant-bound rule is proven in files.test.ts (a public theme-logo is 404 from acme).
      expect(tenantId).not.toBe(acmeId);
    });

    test('replacing deletes the previous upload; removing clears the URL and the file; external URLs are left alone', async () => {
      const first = (await avatarUrlOf([member])) as string;
      const r = await uploadAvatar([member], PNG, 'new.png');
      expect(r.status).toBe(200);
      const second = (await avatarUrlOf([member])) as string;
      expect(second).not.toBe(first);
      expect((await call(first)).status).toBe(404);
      expect((await call(second)).status).toBe(200);

      expect((await call('/v1/users/profile/avatar', { method: 'DELETE' }, [member])).status).toBe(
        200,
      );
      expect(await avatarUrlOf([member])).toBeNull();
      expect((await call(second)).status).toBe(404);

      // An external URL set through the profile form is not a file of ours: removing just clears it.
      await call(
        '/v1/users/profile/me',
        { method: 'PUT', body: JSON.stringify({ avatarUrl: 'https://cdn.example.test/me.png' }) },
        [member],
      );
      expect(await avatarUrlOf([member])).toBe('https://cdn.example.test/me.png');
      expect((await call('/v1/users/profile/avatar', { method: 'DELETE' }, [member])).status).toBe(
        200,
      );
      expect(await avatarUrlOf([member])).toBeNull();
    });
  },
);
