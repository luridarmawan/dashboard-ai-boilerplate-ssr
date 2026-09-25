import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { hashToken, randomToken, runSeed } from '@core/auth';
import { type Db, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): e-mail engagement (J-6). With `mail.track_opens` on, a delivery
 * mints the row's token; the pixel records opens (same GIF for unknown tokens), the click
 * redirect records a click and only ever goes to the link the row's own payload holds, and
 * using the one-time token a mail carried stamps `acted_at` on the latest such mail. With the
 * setting off, nothing is minted.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'D'.repeat(43);
const run = Date.now();
const RUN_IP = `10.81.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `track-admin-${run}@example.test`;
const adminPassword = 'a tracking admin password';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
const put = (body: unknown, cookies: string[]) =>
  call('/v1/configuration', { method: 'PUT', body: JSON.stringify(body) }, cookies);

describe.skipIf(!enabled)('e-mail engagement (J-6): pixel, click, acted', () => {
  let db: Db;
  let admin = '';
  let adminId = '';
  const ids = { tracked: newId(), untracked: newId(), verify: newId(), older: newId() };
  const link = `http://api.test/auth/verify?token=track-${run}`;

  const row = async (id: string) =>
    (await db.select().from(schema.outboxEmail).where(eq(schema.outboxEmail.id, id)).limit(1))[0];
  const seedRow = (id: string, over: Partial<typeof schema.outboxEmail.$inferInsert>) => ({
    id,
    to_address: `reader-${run}@example.test`,
    subject: `trackmark${run}`,
    template: 'verify-email',
    locale: 'en',
    payload: { name: 'Reader', link },
    status: 'pending',
    attempts: 0,
    next_attempt_at: new Date(),
    ...over,
  });
  /** The worker takes 25 due rows per pass; the shared outbox may hold more, so loop. */
  const deliverUntil = async (id: string) => {
    for (let i = 0; i < 8; i++) {
      if ((await row(id))?.status !== 'pending') return;
      await call('/v1/outbox/deliver', { method: 'POST' }, [admin]);
    }
  };

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    await runSeed(db, { adminEmail, adminPassword });
    const res = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(res.status).toBe(200);
    admin = sessionCookie(res);
    const me = await json(await call('/v1/auth/me', {}, [admin]));
    adminId = String((me.data?.user as { id: string } | undefined)?.id ?? '');
    // Global: tracking off. Rows have no tenant, so the global value is what they follow.
    expect(
      (await put({ scope: 'global', values: { 'mail.track_opens': false } }, [admin])).status,
    ).toBe(200);
  });

  afterAll(async () => {
    if (!enabled) return;
    await put({ scope: 'global', values: { 'mail.track_opens': false } }, [admin]);
    for (const id of Object.values(ids))
      await db.delete(schema.outboxEmail).where(eq(schema.outboxEmail.id, id));
  });

  test('tracking off: a delivery mints no token', async () => {
    await db.insert(schema.outboxEmail).values(seedRow(ids.untracked, {}) as never);
    await deliverUntil(ids.untracked);
    const r = await row(ids.untracked);
    expect(r?.status).toBe('sent');
    expect(r?.open_token).toBeNull();
  });

  test('tracking on: the delivery mints a token; the pixel counts opens; unknown tokens get the same GIF', async () => {
    expect(
      (await put({ scope: 'global', values: { 'mail.track_opens': true } }, [admin])).status,
    ).toBe(200);
    await db.insert(schema.outboxEmail).values(seedRow(ids.tracked, {}) as never);
    await deliverUntil(ids.tracked);
    const sent = await row(ids.tracked);
    expect(sent?.status).toBe('sent');
    expect(sent?.open_token).toMatch(/^[0-9a-f]{32}$/);
    expect(sent?.opened_at).toBeNull();

    const pixel = await call(`/v1/mail/o/${sent?.open_token}.gif`);
    expect(pixel.status).toBe(200);
    expect(pixel.headers.get('content-type')).toBe('image/gif');
    expect(pixel.headers.get('cache-control')).toContain('no-store');
    const bytes = new Uint8Array(await pixel.arrayBuffer());
    expect(bytes.length).toBe(43);
    expect(Array.from(bytes.slice(0, 6))).toEqual([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    await call(`/v1/mail/o/${sent?.open_token}.gif`);
    const opened = await row(ids.tracked);
    expect(opened?.opened_at).not.toBeNull();
    expect(opened?.open_count).toBe(2);

    // Unknown token: identical answer, nothing to learn from it.
    const unknown = await call('/v1/mail/o/ffffffffffffffffffffffffffffffff.gif');
    expect(unknown.status).toBe(200);
    expect(new Uint8Array(await unknown.arrayBuffer()).length).toBe(43);
  });

  test('the click redirects to the payload link and records the click; unknown tokens are 404', async () => {
    const sent = await row(ids.tracked);
    const click = await call(`/v1/mail/c/${sent?.open_token}`, { redirect: 'manual' });
    expect(click.status).toBe(302);
    expect(click.headers.get('location')).toBe(link);
    expect((await row(ids.tracked))?.clicked_at).not.toBeNull();
    expect((await call('/v1/mail/c/ffffffffffffffffffffffffffffffff')).status).toBe(404);
    expect((await call('/v1/mail/c/not-a-token')).status).toBe(404);
  });

  test('a re-send keeps the same token, so the row keeps one identity', async () => {
    const before = (await row(ids.tracked))?.open_token;
    await call(`/v1/outbox/${ids.tracked}/resend`, { method: 'POST' }, [admin]);
    await deliverUntil(ids.tracked);
    const after = await row(ids.tracked);
    expect(after?.status).toBe('sent');
    expect(after?.open_token).toBe(before ?? '');
  });

  test('using the one-time token stamps acted_at on the LATEST mail of that kind to that address', async () => {
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    await db.insert(schema.outboxEmail).values([
      seedRow(ids.older, {
        to_address: adminEmail,
        status: 'sent',
        sent_at: at(10),
        created_at: at(10),
        updated_at: at(10),
      }),
      seedRow(ids.verify, {
        to_address: adminEmail,
        status: 'sent',
        sent_at: at(1),
        created_at: at(1),
        updated_at: at(1),
      }),
    ] as never);
    const raw = randomToken();
    await db.insert(schema.emailVerificationTokens).values({
      id: newId(),
      user_id: adminId,
      token_hash: hashToken(raw),
      expires_at: new Date(Date.now() + 3_600_000),
    } as never);
    expect((await call(`/v1/auth/verify-email?token=${raw}`)).status).toBe(200);
    const latest = await row(ids.verify);
    expect(latest?.acted_at).not.toBeNull();
    expect(latest?.opened_at).not.toBeNull(); // following the link is an open too
    expect((await row(ids.older))?.acted_at).toBeNull();
  });

  test('the outbox listing carries the engagement fields', async () => {
    // By recipient: a delivery rewrites the subject with the rendered one, the address stays.
    const r = await json(await call(`/v1/outbox?q=reader-${run}`, {}, [admin]));
    const rows = r.data as unknown as {
      id: string;
      openedAt: string | null;
      openCount: number;
      clickedAt: string | null;
      actedAt: string | null;
    }[];
    const tracked = rows.find((x) => x.id === ids.tracked);
    expect(tracked?.openCount).toBe(2);
    expect(tracked?.openedAt).toBeTruthy();
    expect(tracked?.clickedAt).toBeTruthy();
    const mine = await json(await call(`/v1/outbox?q=${adminEmail}`, {}, [admin]));
    const acted = (mine.data as unknown as { id: string; actedAt: string | null }[]).find(
      (x) => x.id === ids.verify,
    );
    expect(acted?.actedAt).toBeTruthy();
  });
});
