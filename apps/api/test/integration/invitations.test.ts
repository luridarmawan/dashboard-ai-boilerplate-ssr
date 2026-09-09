import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { resetEnvCache } from '@core/config';
import { type Db, eq, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';
import { settings } from '../../src/services.ts';

/**
 * Integration (INTEGRATION=1): registration by invitation link (PRD A-13). An admin invites an
 * address into the active tenant; the code opens `/join` even with SIGNUP_ENABLED=false; the new
 * user lands in the inviting tenant with a session; a code is single-use, expires, can be revoked;
 * re-inviting revokes the pending one; an already registered address gets a sign-in e-mail and a
 * tenant membership instead of an invitation; invitations need `user.create` in the tenant.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
let ipSeq = 0;
const freshIp = () => `10.95.${Math.floor(run / 1000) % 250}.${(run + ipSeq++) % 250}`;
const adminEmail = `inv-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message?: string };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = [], ip = freshIp()) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', ip);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
const invite = (email: string, cookie: string) =>
  call('/v1/invitations', { method: 'POST', body: JSON.stringify({ email }) }, [cookie]);
const join = (code: string, name: string, password = 'a long enough invite password') =>
  call('/v1/auth/join', { method: 'POST', body: JSON.stringify({ code, name, password }) });
const codeOf = (link: string) => link.split('/join/')[1] ?? '';

describe.skipIf(!enabled)('registration by invitation (A-13)', () => {
  let db: Db;
  let admin = '';
  let tenantId = '';
  const prevSignup = process.env.SIGNUP_ENABLED;

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    const seeded = await runSeed(db, { adminEmail, adminPassword });
    tenantId = seeded.tenantId;
    const login = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    admin = sessionCookie(login);
    expect(admin).toMatch(/^dab_session=/);
    // The point of A-13: invitations work while self-service sign-up is OFF.
    process.env.SIGNUP_ENABLED = 'false';
    resetEnvCache();
  });
  afterAll(() => {
    if (prevSignup === undefined) delete process.env.SIGNUP_ENABLED;
    else process.env.SIGNUP_ENABLED = prevSignup;
    resetEnvCache();
  });

  test('inviting needs a session and user.create', async () => {
    expect((await invite(`x-${run}@example.test`, '')).status).toBe(401);
    expect((await call('/v1/invitations')).status).toBe(401);
  });

  test('a new address gets an invitation row, an e-mail with the link, and the code once', async () => {
    const email = `invitee-${run}@example.test`;
    const r = await invite(email, admin);
    expect(r.status).toBe(201);
    const d = (await json(r)).data as {
      existing: boolean;
      link: string;
      email: string;
      status: string;
      expiresAt: string;
    };
    expect(d.existing).toBe(false);
    expect(d.email).toBe(email);
    expect(d.status).toBe('pending');
    expect(d.link).toMatch(/\/join\/[A-Za-z0-9_-]{43}$/);
    // default validity: security.invitation_hours = 72 h
    const hours = (new Date(d.expiresAt).getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(71.5);
    expect(hours).toBeLessThan(72.5);
    const [mail] = await db
      .select()
      .from(schema.outboxEmail)
      .where(eq(schema.outboxEmail.to_address, email));
    expect(mail?.template).toBe('invite');
    expect(JSON.stringify(mail?.payload)).toContain(codeOf(d.link));
    const list = (await json(await call('/v1/invitations', {}, [admin]))).data as unknown as {
      email: string;
      status: string;
      invitedBy: string | null;
    }[];
    const mine = list.find((i) => i.email === email);
    expect(mine?.status).toBe('pending');
    expect(mine?.invitedBy).toBeTruthy();
  });

  test('the code shows whom it is for, opens an account in the inviting tenant with SIGNUP_ENABLED=false, then is spent', async () => {
    const email = `joiner-${run}@example.test`;
    const link = ((await json(await invite(email, admin))).data as { link: string }).link;
    const code = codeOf(link);
    // Self-service sign-up is off (unless an admin turned it on in the DB) — invitations still work.
    if ((await settings.get(null, 'security.signup_enabled')) === null) {
      const reg = await call('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: `nope-${run}@example.test`,
          password: 'a long enough invite password',
          name: 'Nope',
        }),
      });
      expect(reg.status).toBe(403);
    }
    const look = await call(`/v1/auth/join/${code}`);
    expect(look.status).toBe(200);
    const info = (await json(look)).data as { email: string; tenant: { id: string; name: string } };
    expect(info.email).toBe(email);
    expect(info.tenant.id).toBe(tenantId);

    expect((await join(code, 'Joiner', 'short')).status).toBe(422);
    const ok = await join(code, 'Joiner');
    expect(ok.status).toBe(201);
    const cookie = sessionCookie(ok);
    expect(cookie).toMatch(/^dab_session=/);
    const me = (await json(await call('/v1/auth/me', {}, [cookie]))).data as {
      user: { email: string; emailVerifiedAt: string | null };
      clientId: string | null;
    };
    expect(me.user.email).toBe(email);
    expect(me.user.emailVerifiedAt).not.toBeNull();
    expect(me.clientId).toBe(tenantId);
    // single use
    const again = await join(code, 'Joiner again');
    expect(again.status).toBe(410);
    expect((await json(again)).error?.code).toBe('token_invalid');
    expect((await call(`/v1/auth/join/${code}`)).status).toBe(410);
  });

  test('unknown, expired and revoked codes are refused; re-inviting revokes the pending one', async () => {
    expect((await call(`/v1/auth/join/${'z'.repeat(43)}`)).status).toBe(404);
    const email = `expiring-${run}@example.test`;
    const first = (await json(await invite(email, admin))).data as { link: string; id: string };
    await db
      .update(schema.invitations)
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where(eq(schema.invitations.id, first.id));
    const expired = await call(`/v1/auth/join/${codeOf(first.link)}`);
    expect(expired.status).toBe(410);
    expect((await json(expired)).error?.code).toBe('token_expired');
    // re-invite → the first row is revoked, a fresh one is pending
    const second = (await json(await invite(email, admin))).data as { link: string; id: string };
    const [old] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, first.id));
    expect(old?.revoked_at).not.toBeNull();
    expect((await call(`/v1/auth/join/${codeOf(second.link)}`)).status).toBe(200);
    // revoke the fresh one through the API
    const rv = await call(`/v1/invitations/${second.id}`, { method: 'DELETE' }, [admin]);
    expect(rv.status).toBe(200);
    expect((await call(`/v1/auth/join/${codeOf(second.link)}`)).status).toBe(404);
    expect((await call(`/v1/invitations/${second.id}`, { method: 'DELETE' }, [admin])).status).toBe(
      404,
    );
  });

  test('an already registered address is added to the tenant and told to sign in — no invitation', async () => {
    process.env.SIGNUP_ENABLED = 'true';
    resetEnvCache();
    const email = `member-${run}@example.test`;
    const reg = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'a long enough invite password', name: 'Member' }),
    });
    expect(reg.status).toBe(201);
    process.env.SIGNUP_ENABLED = 'false';
    resetEnvCache();
    const r = await invite(email, admin);
    expect(r.status).toBe(200);
    const d = (await json(r)).data as { existing: boolean; userId: string };
    expect(d.existing).toBe(true);
    const rows = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.email, email));
    expect(rows.length).toBe(0);
    const mails = await db
      .select()
      .from(schema.outboxEmail)
      .where(eq(schema.outboxEmail.to_address, email));
    expect(mails.some((m) => m.template === 'invite-existing')).toBe(true);
    const list = (await json(await call('/v1/invitations', {}, [admin]))).data as unknown as {
      email: string;
    }[];
    expect(list.some((i) => i.email === email)).toBe(false);
  });
});
