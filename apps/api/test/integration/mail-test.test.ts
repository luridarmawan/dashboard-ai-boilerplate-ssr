import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, unsafeAcrossTenants } from '@core/db';
import { startFakeSmtp } from '../../../../packages/mail/test/fake-smtp.ts';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): the Settings → Email tester (extension point 6 action of the
 * `mail` section) against a real database and a real SMTP conversation on 127.0.0.1. What it
 * proves: the recipient defaults to the SMTP account in effect, an explicit recipient wins, the
 * global scope and a tenant that overrides it are tested as two different configurations, and a
 * malformed address is refused before anything is sent.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'D'.repeat(43);
const run = Date.now();
const RUN_IP = `10.79.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `mailtest-admin-${run}@example.test`;
const adminPassword = 'a mail tester password';

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
    expect(smtp?.envelopes.at(-1)).toEqual({
      from: 'noreply@global.test',
      to: ['global-account@fake.test'],
    });
    expect(smtp?.auths.at(-1)).toEqual({ user: 'global-account@fake.test', pass: 'global-secret' });
    const src = smtp?.messages.at(-1) ?? '';
    expect(src).toContain(`127.0.0.1:${smtp?.port}`);
    expect(src).toContain('Pengaturan');
    expect(src).not.toContain('global-secret');
    // The details say what was tested, with no secret in them either.
    expect(result.details.join(' ')).toContain(`127.0.0.1:${smtp?.port}`);
    expect(result.details.join(' ')).not.toContain('global-secret');
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
    expect(smtp?.envelopes.at(-1)?.to).toEqual(['orang@contoh.test']);
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
      to: ['tenant-account@fake.test'],
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
