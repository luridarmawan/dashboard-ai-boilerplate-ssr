import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { resetEnvCache } from '@core/config';
import { and, type Db, desc, eq, schema, unsafeAcrossTenants } from '@core/db';
import { SMTP_TEST_TEMPLATE } from '@core/mail';
import { startFakeSmtp } from '../../../../packages/mail/test/fake-smtp.ts';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): the Settings → Email tester (extension point 6 action of the
 * `mail` section) against a real database and a real SMTP conversation on 127.0.0.1. What it
 * proves: the recipient defaults to the SMTP account in effect, an explicit recipient wins, the
 * global scope and a tenant that overrides it are tested as two different configurations, a
 * malformed address is refused before anything is sent, every test leaves an `smtp-test` row in
 * the outbox (sent or failed) that can be sent again from there, and MAIL_BCC rides on the
 * envelope of the test and of every outbox delivery.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'D'.repeat(43);
const run = Date.now();
const RUN_IP = `10.79.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `mailtest-admin-${run}@example.test`;
const adminPassword = 'a mail tester password';
const BCC = `arsip-${run}@fake.test`;

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
const put = (body: unknown, cookies: string[]) =>
  call('/v1/configuration', { method: 'PUT', body: JSON.stringify(body) }, cookies);
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';

interface ActionResult {
  ok: boolean;
  message: string;
  details: string[];
}
interface MailSectionView {
  section: string;
  actions: {
    key: string;
    endpoint: string;
    input: { key: string; type: string; default: string } | null;
  }[];
}
const mailSection = (e: Envelope) =>
  ((e.data?.sections ?? []) as MailSectionView[]).find((s) => s.section === 'mail');
const CLEAR = {
  'mail.smtp_host': '',
  'mail.smtp_port': '',
  'mail.smtp_user': '',
  'mail.smtp_password': '__clear__',
  'mail.from_name': '',
  'mail.from_address': '',
};

describe.skipIf(!enabled)('settings → email tester (J-1, E-3, extension point 6)', () => {
  const smtp = enabled ? startFakeSmtp() : null;
  let db: Db;
  let admin = '';

  /** The newest outbox row for a recipient — the one the test just left behind. */
  const lastRowFor = async (to: string) => {
    const [row] = await db
      .select()
      .from(schema.outboxEmail)
      .where(
        and(
          eq(schema.outboxEmail.to_address, to),
          eq(schema.outboxEmail.template, SMTP_TEST_TEMPLATE),
        ),
      )
      .orderBy(desc(schema.outboxEmail.created_at))
      .limit(1);
    return row;
  };

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    // MAIL_BCC is .env only; `env()` is a cached singleton, so it has to be re-read.
    process.env.MAIL_BCC = BCC;
    resetEnvCache();
    await runSeed(db, { adminEmail, adminPassword });
    const res = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(res.status).toBe(200);
    admin = sessionCookie(res);
    // Global: the fake server. Tenant: left empty for now, so it inherits the global one.
    await put({ scope: 'global', values: CLEAR }, [admin]);
    await put({ values: CLEAR }, [admin]);
    await put(
      {
        scope: 'global',
        values: {
          'mail.smtp_host': '127.0.0.1',
          'mail.smtp_port': String(smtp?.port ?? 0),
          'mail.smtp_user': 'global-account@fake.test',
          'mail.smtp_password': 'global-secret',
          'mail.from_name': 'Global Dash',
          'mail.from_address': 'noreply@global.test',
        },
      },
      [admin],
    );
  });

  afterAll(async () => {
    if (!enabled) return;
    // Other suites share this database: leave `mail.*` as empty as it was found.
    await put({ values: CLEAR }, [admin]);
    await put({ scope: 'global', values: CLEAR }, [admin]);
    await db.delete(schema.outboxEmail).where(eq(schema.outboxEmail.template, SMTP_TEST_TEMPLATE));
    delete process.env.MAIL_BCC;
    resetEnvCache();
    smtp?.close();
  });

  test('the section declares the button, and its input opens on the SMTP account in effect', async () => {
    const view = await json(await call('/v1/configuration?scope=global', {}, [admin]));
    const action = mailSection(view)?.actions.find((a) => a.key === 'test');
    expect(action?.endpoint).toBe('/v1/configuration/mail/test');
    expect(action?.input).toMatchObject({ key: 'to', type: 'email' });
    expect(action?.input?.default).toBe('global-account@fake.test');
  });

  test('an empty recipient goes to the SMTP account; the message names the server, never the password', async () => {
    const r = await json(
      await call(
        '/v1/configuration/mail/test',
        {
          method: 'POST',
          body: JSON.stringify({ scope: 'global', to: '' }),
        },
        [admin],
      ),
    );
    const result = r.data as unknown as ActionResult;
    expect(result.ok).toBe(true);
    expect(result.message).toContain('global-account@fake.test');
    // MAIL_BCC is on the envelope (an extra RCPT TO), never in the To header.
    expect(smtp?.envelopes.at(-1)).toEqual({
      from: 'noreply@global.test',
      to: ['global-account@fake.test', BCC],
    });
    expect(smtp?.auths.at(-1)).toEqual({ user: 'global-account@fake.test', pass: 'global-secret' });
    const src = smtp?.messages.at(-1) ?? '';
    expect(src).toContain(`127.0.0.1:${smtp?.port}`);
    expect(src).toContain('Pengaturan');
    expect(src).not.toContain('global-secret');
    expect(src).not.toMatch(new RegExp(`^To:.*${BCC}`, 'mi'));
    // The details say what was tested, with no secret in them either.
    expect(result.details.join(' ')).toContain(`127.0.0.1:${smtp?.port}`);
    expect(result.details.join(' ')).toContain(`bcc ${BCC}`);
    expect(result.details.join(' ')).not.toContain('global-secret');
    // The test is on record in the outbox: delivered, one attempt, through SMTP.
    const row = await lastRowFor('global-account@fake.test');
    expect(row).toMatchObject({
      status: 'sent',
      attempts: 1,
      transport: 'smtp',
      last_error: null,
      client_id: null,
    });
    expect(row?.subject).toMatch(/^Tes SMTP/);
    expect(row?.sent_at).not.toBeNull();
  });

  test('with mail.track_opens on, the test mail carries the pixel and the row its token', async () => {
    await put({ scope: 'global', values: { 'mail.track_opens': true } }, [admin]);
    try {
      const r = await json(
        await call(
          '/v1/configuration/mail/test',
          { method: 'POST', body: JSON.stringify({ scope: 'global', to: 'lacak@contoh.test' }) },
          [admin],
        ),
      );
      const result = r.data as unknown as ActionResult;
      expect(result.ok).toBe(true);
      expect(result.details.join(' ')).toContain('pixel');
      const row = await lastRowFor('lacak@contoh.test');
      expect(row?.open_token).toMatch(/^[0-9a-f]{32}$/);
      // Quoted-printable may fold the line, so compare on the unfolded source.
      const src = (smtp?.messages.at(-1) ?? '').replace(/=\r\n/g, '');
      expect(src).toContain(`/v1/mail/o/${row?.open_token}.gif`);
      // Opening it marks the row: the whole point of trying tracking with the test mail.
      expect((await call(`/v1/mail/o/${row?.open_token}.gif`)).status).toBe(200);
      expect((await lastRowFor('lacak@contoh.test'))?.opened_at).not.toBeNull();
    } finally {
      await put({ scope: 'global', values: { 'mail.track_opens': false } }, [admin]);
    }
  });

  test('a test that fails is on record too, as a failed row, and can be sent again from the outbox', async () => {
    // A port nothing listens on: verify() fails before any envelope is sent.
    await put({ scope: 'global', values: { 'mail.smtp_port': '9' } }, [admin]);
    const before = smtp?.messages.length ?? 0;
    const r = await json(
      await call(
        '/v1/configuration/mail/test',
        { method: 'POST', body: JSON.stringify({ scope: 'global', to: 'gagal@contoh.test' }) },
        [admin],
      ),
    );
    expect((r.data as unknown as ActionResult).ok).toBe(false);
    expect(smtp?.messages.length).toBe(before);
    const failed = await lastRowFor('gagal@contoh.test');
    expect(failed?.status).toBe('failed');
    expect(failed?.last_error).toContain('Koneksi/autentikasi');
    await put({ scope: 'global', values: { 'mail.smtp_port': String(smtp?.port ?? 0) } }, [admin]);

    // Send again: the worker re-renders it against the SMTP in effect NOW — the fake server —
    // and the copy goes to MAIL_BCC like every outbox delivery.
    const resend = await json(
      await call(`/v1/outbox/${failed?.id}/resend`, { method: 'POST' }, [admin]),
    );
    expect((resend.data as { requeued: number }).requeued).toBe(1);
    // The shared outbox may hold older due rows; a pass takes 25, so run until ours is taken.
    let delivered = await lastRowFor('gagal@contoh.test');
    for (let i = 0; i < 8 && delivered?.status === 'pending'; i++) {
      await call('/v1/outbox/deliver', { method: 'POST' }, [admin]);
      delivered = await lastRowFor('gagal@contoh.test');
    }
    expect(delivered?.id).toBe(failed?.id);
    expect(delivered).toMatchObject({ status: 'sent', attempts: 1, transport: 'smtp' });
    expect(smtp?.envelopes.at(-1)).toEqual({
      from: 'noreply@global.test',
      to: ['gagal@contoh.test', BCC],
    });
    expect(smtp?.messages.at(-1) ?? '').toContain(`127.0.0.1:${smtp?.port}`);
  });

  test('an explicit recipient wins', async () => {
    const r = await json(
      await call(
        '/v1/configuration/mail/test',
        {
          method: 'POST',
          body: JSON.stringify({ scope: 'global', to: ' orang@contoh.test ' }),
        },
        [admin],
      ),
    );
    expect((r.data as unknown as ActionResult).ok).toBe(true);
    expect(smtp?.envelopes.at(-1)?.to).toEqual(['orang@contoh.test', BCC]);
  });

  test('a malformed address is refused before anything is sent (422)', async () => {
    const before = smtp?.messages.length ?? 0;
    const res = await call(
      '/v1/configuration/mail/test',
      {
        method: 'POST',
        body: JSON.stringify({ scope: 'global', to: 'bukan-alamat' }),
      },
      [admin],
    );
    expect(res.status).toBe(422);
    expect((await json(res)).error?.code).toBe('validation_failed');
    expect(smtp?.messages.length).toBe(before);
  });

  test('the tenant scope tests the tenant’s own SMTP, not the global one', async () => {
    await put(
      {
        values: {
          'mail.smtp_host': '127.0.0.1',
          'mail.smtp_port': String(smtp?.port ?? 0),
          'mail.smtp_user': 'tenant-account@fake.test',
          'mail.smtp_password': 'tenant-secret',
          'mail.from_name': 'Tenant Dash',
          'mail.from_address': 'noreply@tenant.test',
        },
      },
      [admin],
    );
    const view = await json(await call('/v1/configuration', {}, [admin]));
    expect(mailSection(view)?.actions.find((a) => a.key === 'test')?.input?.default).toBe(
      'tenant-account@fake.test',
    );
    const r = await json(
      await call('/v1/configuration/mail/test', { method: 'POST', body: JSON.stringify({}) }, [
        admin,
      ]),
    );
    expect((r.data as unknown as ActionResult).ok).toBe(true);
    expect(smtp?.envelopes.at(-1)).toEqual({
      from: 'noreply@tenant.test',
      to: ['tenant-account@fake.test', BCC],
    });
    expect(smtp?.auths.at(-1)).toEqual({ user: 'tenant-account@fake.test', pass: 'tenant-secret' });
  });

  test('a scope with no SMTP answers "not configured" instead of failing the request', async () => {
    await put({ values: CLEAR }, [admin]);
    await put({ scope: 'global', values: CLEAR }, [admin]);
    const res = await call(
      '/v1/configuration/mail/test',
      {
        method: 'POST',
        body: JSON.stringify({ scope: 'global' }),
      },
      [admin],
    );
    expect(res.status).toBe(200);
    const result = (await json(res)).data as unknown as ActionResult;
    expect(result.ok).toBe(false);
    expect(result.message).toContain('SMTP belum dikonfigurasi');
  });
});
