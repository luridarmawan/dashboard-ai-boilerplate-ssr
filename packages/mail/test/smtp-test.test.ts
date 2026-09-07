import { afterAll, describe, expect, test } from 'bun:test';
import {
  buildTestMessage,
  createSmtpTransport,
  formatFrom,
  sendTestEmail,
  smtpFromEnv,
  smtpHints,
  tlsMode,
} from '../src/index.ts';
import { startFakeSmtp } from './fake-smtp.ts';

/** `bun run mail:test`: SMTP purely from .env, one test message, hints for the usual failures. */
describe('smtpFromEnv', () => {
  test('nothing → null (host and from-address are the minimum)', () => {
    expect(smtpFromEnv({})).toBeNull();
    expect(smtpFromEnv({ SMTP_HOST: 'smtp.x.test' })).toBeNull();
    expect(smtpFromEnv({ MAIL_FROM_ADDRESS: 'a@x.test' })).toBeNull();
    expect(smtpFromEnv({ SMTP_HOST: '  ', MAIL_FROM_ADDRESS: 'a@x.test' })).toBeNull();
  });
  test('minimum → defaults: port 587, STARTTLS, no auth, from-name = app name', () => {
    const s = smtpFromEnv({ SMTP_HOST: 'smtp.x.test', MAIL_FROM_ADDRESS: 'a@x.test' }, 'Acme');
    expect(s).toEqual({
      host: 'smtp.x.test',
      port: 587,
      user: null,
      password: null,
      fromName: 'Acme',
      fromAddress: 'a@x.test',
    });
    expect(tlsMode(s!)).toBe('STARTTLS');
  });
  test('full .env; 465 implies SMTPS; SMTP_SECURE overrides the port rule', () => {
    const base = {
      SMTP_HOST: 'smtp.x.test',
      SMTP_PORT: '465',
      SMTP_USER: 'u',
      SMTP_PASSWORD: 'p w',
      MAIL_FROM_ADDRESS: 'a@x.test',
      MAIL_FROM_NAME: 'Env App',
    };
    const s = smtpFromEnv(base)!;
    expect(s).toMatchObject({ port: 465, user: 'u', password: 'p w', fromName: 'Env App' });
    expect(s.secure).toBeUndefined();
    expect(tlsMode(s)).toBe('SMTPS (implicit TLS)');
    expect(smtpFromEnv({ ...base, SMTP_SECURE: 'false' })!.secure).toBe(false);
    expect(tlsMode(smtpFromEnv({ ...base, SMTP_SECURE: 'false' })!)).toBe('STARTTLS');
    expect(smtpFromEnv({ ...base, SMTP_PORT: '2525', SMTP_SECURE: 'true' })!.secure).toBe(true);
  });
  test('malformed values throw instead of silently sending elsewhere', () => {
    const ok = { SMTP_HOST: 'smtp.x.test', MAIL_FROM_ADDRESS: 'a@x.test' };
    expect(() => smtpFromEnv({ ...ok, SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/);
    expect(() => smtpFromEnv({ ...ok, SMTP_PORT: '70000' })).toThrow(/SMTP_PORT/);
    expect(() => smtpFromEnv({ ...ok, SMTP_SECURE: 'yes' })).toThrow(/SMTP_SECURE/);
    expect(() => smtpFromEnv({ ...ok, MAIL_FROM_ADDRESS: 'not-an-email' })).toThrow(
      /MAIL_FROM_ADDRESS/,
    );
  });
});

const smtp = {
  host: 'smtp.x.test',
  port: 587,
  user: 'user@x.test',
  password: 'secret-password',
  fromName: 'Acme "Dash"',
  fromAddress: 'noreply@x.test',
};

describe('test message', () => {
  test('names server, port, TLS mode and account; never the password; quotes stripped from name', () => {
    const m = buildTestMessage(smtp, 'me@x.test', { sentAt: new Date('2026-09-07T10:00:00Z') });
    expect(m.to).toBe('me@x.test');
    expect(m.from).toBe('"Acme Dash" <noreply@x.test>');
    expect(formatFrom(smtp)).toBe(m.from);
    expect(m.subject).toContain('Tes SMTP');
    expect(m.subject).toContain('2026-09-07T10:00:00.000Z');
    for (const body of [m.text, m.html]) {
      expect(body).toContain('smtp.x.test:587');
      expect(body).toContain('STARTTLS');
      expect(body).toContain('user@x.test');
      expect(body).not.toContain('secret-password');
    }
    expect(m.html).toContain('&quot;Acme Dash&quot; &lt;noreply@x.test&gt;');
  });
  test('sendTestEmail hands the message to the transport and normalises the result', async () => {
    const sent: unknown[] = [];
    const transport = {
      sendMail: async (msg: unknown) => {
        sent.push(msg);
        return {
          messageId: '<id@x.test>',
          accepted: ['me@x.test'],
          rejected: [{ address: 'bad@x.test' }],
          response: '250 OK',
        };
      },
    };
    const r = await sendTestEmail(smtp, 'me@x.test', { transport, subject: 'Custom' });
    expect(r).toEqual({
      messageId: '<id@x.test>',
      accepted: ['me@x.test'],
      rejected: ['bad@x.test'],
      response: '250 OK',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'me@x.test', subject: 'Custom' });
  });
});

describe('smtpHints', () => {
  test('maps the usual failures to something actionable; unknown errors get none', () => {
    expect(smtpHints({ code: 'EAUTH', responseCode: 535 }).join(' ')).toMatch(/App Password/);
    expect(smtpHints({ code: 'ECONNECTION', message: 'connect ECONNREFUSED' }).join(' ')).toMatch(
      /SMTP_PORT/,
    );
    expect(smtpHints({ code: 'ESOCKET', message: 'wrong version number' }).join(' ')).toMatch(
      /SMTP_SECURE/,
    );
    expect(smtpHints({ code: 'ETIMEDOUT', message: 'Connection timeout' }).join(' ')).toMatch(
      /firewall/,
    );
    expect(smtpHints({ message: 'self signed certificate' }).join(' ')).toMatch(/Sertifikat/);
    expect(smtpHints({ code: 'EENVELOPE', responseCode: 550 }).join(' ')).toMatch(
      /MAIL_FROM_ADDRESS/,
    );
    expect(smtpHints(new Error('something odd'))).toEqual([]);
  });
});

describe('over the wire (fake SMTP on 127.0.0.1)', () => {
  const server = startFakeSmtp();
  afterAll(() => server.close());
  const wire = {
    host: '127.0.0.1',
    port: server.port,
    user: 'probe-user',
    password: 'probe-pass',
    fromName: 'Probe',
    fromAddress: 'noreply@x.test',
  };

  test('verify() authenticates with SMTP_USER/SMTP_PASSWORD', async () => {
    const t = createSmtpTransport(wire, { timeoutMs: 3000 });
    expect(await t.verify()).toBe(true);
    t.close();
    expect(server.auths.at(-1)).toEqual({ user: 'probe-user', pass: 'probe-pass' });
  });

  test('sendTestEmail() delivers the test message with the right envelope', async () => {
    const r = await sendTestEmail(wire, 'me@x.test', { subject: 'SMTP probe', timeoutMs: 3000 });
    expect(r.accepted).toEqual(['me@x.test']);
    expect(r.rejected).toEqual([]);
    expect(r.response).toStartWith('250');
    expect(server.envelopes.at(-1)).toEqual({ from: 'noreply@x.test', to: ['me@x.test'] });
    const src = server.messages.at(-1) ?? '';
    expect(src).toContain('Subject: SMTP probe');
    expect(src).toContain('From: Probe <noreply@x.test>'); // nodemailer drops needless quotes
    expect(src).toContain(`127.0.0.1:${server.port}`);
    expect(src).not.toContain('probe-pass');
  });

  test('a wrong password surfaces as EAUTH with a hint', async () => {
    const t = createSmtpTransport({ ...wire, user: '', password: 'x' }, { timeoutMs: 3000 });
    // Empty user → transport skips AUTH; force the failure path with a user the fake rejects.
    t.close();
    const bad = createSmtpTransport({ ...wire, user: '\0', password: 'x' }, { timeoutMs: 3000 });
    const err = await bad.verify().catch((e: unknown) => e);
    bad.close();
    expect((err as { code?: string }).code).toBe('EAUTH');
    expect(smtpHints(err).join(' ')).toMatch(/SMTP_USER/);
  });
});
