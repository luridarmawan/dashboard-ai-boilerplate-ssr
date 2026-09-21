import { beforeAll, describe, expect, test } from 'bun:test';
import { hashToken, runSeed } from '@core/auth';
import {
  and,
  type Db,
  desc,
  eq,
  inArray,
  isNull,
  newId,
  schema,
  unsafeAcrossTenants,
} from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): an administrator resets a member's credentials from the user
 * detail page (PRD D-1) — `PUT /v1/users/:id/password` sets a password outright and ends every
 * session of the target, `POST /v1/users/:id/password/reset-link` mails the A-7 link on the
 * member's behalf. Both need `user.edit` inside the active tenant, never act on oneself (the
 * profile page does that with the current password), and the link is refused for `.test` /
 * `.invalid` addresses because nothing behind those domains receives mail (RFC 2606).
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'D'.repeat(43);
const run = Date.now();
const RUN_IP = `10.96.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `pw-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
// The reset link needs a deliverable-looking address; tests only queue mail, nothing is sent.
const memberEmail = `pw-member-${run}@example.com`;
const memberPassword = 'a regular member password';
const fixtureEmail = `pw-fixture-${run}@example.test`;
const fixturePassword = 'a fixture account password';

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; message?: string; details?: Record<string, unknown> };
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
const cookieOf = (r: Response, name: string) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0] ?? '';
const login = (email: string, password: string) =>
  call('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
const setPassword = (id: string, newPassword: string, cookies: string[]) =>
  call(
    `/v1/users/${id}/password`,
    { method: 'PUT', body: JSON.stringify({ newPassword }) },
    cookies,
  );
const resetLink = (id: string, cookies: string[]) =>
  call(`/v1/users/${id}/password/reset-link`, { method: 'POST' }, cookies);
type Me = { user: { id: string; email: string } };
const me = async (cookies: string[]) =>
  (await json(await call('/v1/auth/me', {}, cookies))).data as Me;

describe.skipIf(!enabled)('admin password reset (D-1, A-7)', () => {
  let db: Db;
  let admin = '';
  let adminId = '';
  let member = '';
  let memberId = '';
  let fixtureId = '';

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    await runSeed(db, { adminEmail, adminPassword });
    admin = cookieOf(await login(adminEmail, adminPassword), 'crk_session');
    adminId = (await me([admin])).user.id;
    const reg = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: memberEmail, password: memberPassword, name: 'Member' }),
    });
    expect(reg.status).toBe(201);
    member = cookieOf(reg, 'crk_session');
    memberId = (await me([member])).user.id;
    const fx = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: fixtureEmail, password: fixturePassword, name: 'Fixture' }),
    });
    expect(fx.status).toBe(201);
    fixtureId = (await me([cookieOf(fx, 'crk_session')])).user.id;
  });

  test('user.edit is required; unknown users are 404; one’s own password is refused (profile page)', async () => {
    expect((await setPassword(memberId, 'whatever it is', [])).status).toBe(401);
    // A plain member holds no `user.edit`: neither route is theirs.
    expect((await setPassword(adminId, 'not going to happen', [member])).status).toBe(403);
    expect((await resetLink(adminId, [member])).status).toBe(403);
    expect(
      (await setPassword('00000000-0000-4000-8000-000000000000', 'long enough password', [admin]))
        .status,
    ).toBe(404);
    const self = await setPassword(adminId, 'long enough password', [admin]);
    expect(self.status).toBe(409);
  });

  test('the same strength rule as everywhere else: a short password is 422 weak_password', async () => {
    const weak = await setPassword(memberId, 'short', [admin]);
    expect(weak.status).toBe(422);
    expect((await json(weak)).error?.code).toBe('weak_password');
    // Nothing changed: the old password still logs in.
    expect((await login(memberEmail, memberPassword)).status).toBe(200);
  });

  test('set: the new password works, the old one does not, every session of the target ends, audited', async () => {
    // A reset token still in flight must not survive the admin's decision.
    await db.insert(schema.passwordResetTokens).values({
      id: newId(),
      user_id: memberId,
      token_hash: hashToken(`stale-${run}`),
      expires_at: new Date(Date.now() + 3600_000),
    });
    expect((await call('/v1/auth/me', {}, [member])).status).toBe(200);
    const res = await setPassword(memberId, 'a brand new member password', [admin]);
    expect(res.status).toBe(200);
    const data = (await json(res)).data as { changed: true; revokedSessions: number };
    expect(data.changed).toBe(true);
    expect(data.revokedSessions).toBeGreaterThanOrEqual(1);
    // Signed out everywhere — the member's cookie is dead.
    expect((await call('/v1/auth/me', {}, [member])).status).toBe(401);
    expect((await login(memberEmail, memberPassword)).status).toBe(401);
    const fresh = await login(memberEmail, 'a brand new member password');
    expect(fresh.status).toBe(200);
    member = cookieOf(fresh, 'crk_session');
    const [pending] = await db
      .select({ id: schema.passwordResetTokens.id })
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.user_id, memberId),
          isNull(schema.passwordResetTokens.used_at),
        ),
      );
    expect(pending).toBeUndefined();
    const [audit] = await db
      .select({ actor: schema.auditLog.actor_id, after: schema.auditLog.after })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'user.password_set_by_admin'),
          eq(schema.auditLog.resource_id, memberId),
        ),
      )
      .orderBy(desc(schema.auditLog.created_at))
      .limit(1);
    expect(audit?.actor).toBe(adminId);
  });

  test('reset link: refused for a .test address with a reason the web can translate', async () => {
    const res = await resetLink(fixtureId, [admin]);
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error?.code).toBe('validation_failed');
    expect(body.error?.details?.reason).toBe('email_undeliverable');
    // Registration queued a verify-email for this address; no (re)set-password mail may follow it.
    const [queued] = await db
      .select({ id: schema.outboxEmail.id })
      .from(schema.outboxEmail)
      .where(
        and(
          eq(schema.outboxEmail.to_address, fixtureEmail),
          inArray(schema.outboxEmail.template, ['reset-password', 'set-password']),
        ),
      );
    expect(queued).toBeUndefined();
  });

  test('reset link: the mail is queued in the member’s own language, the token opens the A-7 flow for a day, audited', async () => {
    // The recipient chose `en`; the request speaks `id` — the saved preference wins (K-2).
    await db.update(schema.users).set({ locale: 'en' }).where(eq(schema.users.id, memberId));
    const res = await call(
      `/v1/users/${memberId}/password/reset-link`,
      { method: 'POST', headers: { 'accept-language': 'id' } },
      [admin],
    );
    expect(res.status).toBe(200);
    const data = (await json(res)).data as { sent: true; template: string; expiresAt: string };
    expect(data.template).toBe('reset-password'); // the account has a password → "reset" wording
    const ttl = new Date(data.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000);
    const [mail] = await db
      .select({ template: schema.outboxEmail.template, locale: schema.outboxEmail.locale })
      .from(schema.outboxEmail)
      .where(eq(schema.outboxEmail.to_address, memberEmail))
      .orderBy(desc(schema.outboxEmail.created_at))
      .limit(1);
    expect(mail?.template).toBe('reset-password');
    expect(mail?.locale).toBe('en');
    const [token] = await db
      .select({ hash: schema.passwordResetTokens.token_hash })
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.user_id, memberId),
          isNull(schema.passwordResetTokens.used_at),
        ),
      )
      .orderBy(desc(schema.passwordResetTokens.created_at))
      .limit(1);
    expect(token?.hash).toHaveLength(64);
    const [audit] = await db
      .select({ actor: schema.auditLog.actor_id })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'user.password_reset_link'),
          eq(schema.auditLog.resource_id, memberId),
        ),
      )
      .limit(1);
    expect(audit?.actor).toBe(adminId);
  });
});
