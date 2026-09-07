import nodemailer, { type Transporter } from 'nodemailer';
import type { SmtpConfig } from './index.ts';

/**
 * SMTP without the database — the .env bootstrap of J-1 on its own. Same rules as the API's
 * `resolveSmtp()` with every `mail.*` setting empty: host + from-address are the minimum, port
 * defaults to 587, SMTP_SECURE overrides the port rule (465 = implicit TLS). Returns null when
 * .env holds no SMTP at all; throws on values that are present but malformed.
 */
export function smtpFromEnv(
  e: Readonly<Record<string, string | undefined>>,
  appName = 'Dashboard',
): SmtpConfig | null {
  const host = e.SMTP_HOST?.trim() || null;
  const fromAddress = e.MAIL_FROM_ADDRESS?.trim() || null;
  if (!host || !fromAddress) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    throw new Error(`MAIL_FROM_ADDRESS bukan alamat email: "${fromAddress}"`);
  }
  const rawPort = e.SMTP_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SMTP_PORT tidak valid: "${rawPort}" (1–65535)`);
  }
  const rawSecure = e.SMTP_SECURE?.trim();
  if (rawSecure && rawSecure !== 'true' && rawSecure !== 'false') {
    throw new Error(`SMTP_SECURE harus "true" atau "false", bukan "${rawSecure}"`);
  }
  return {
    host,
    port,
    user: e.SMTP_USER?.trim() || null,
    password: e.SMTP_PASSWORD || null,
    fromName: e.MAIL_FROM_NAME?.trim() || appName,
    fromAddress,
    ...(rawSecure ? { secure: rawSecure === 'true' } : {}),
  };
}

export interface TransportOptions {
  /** Cap on connect / greeting / idle socket waits. The outbox worker keeps nodemailer's defaults. */
  readonly timeoutMs?: number;
}

/** One nodemailer transport for an SMTP configuration — shared by the outbox worker and the tester. */
export function createSmtpTransport(smtp: SmtpConfig, opts: TransportOptions = {}): Transporter {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? smtp.port === 465,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? '' } } : {}),
    ...(opts.timeoutMs
      ? {
          connectionTimeout: opts.timeoutMs,
          greetingTimeout: opts.timeoutMs,
          socketTimeout: opts.timeoutMs,
        }
      : {}),
  });
}

/** `"Name" <address>` — quotes stripped from the name so it can never break the header. */
export function formatFrom(smtp: SmtpConfig): string {
  return `"${smtp.fromName.replace(/"/g, '')}" <${smtp.fromAddress}>`;
}

/** TLS mode as a human label, the way the tester and Settings describe it. */
export function tlsMode(smtp: SmtpConfig): 'SMTPS (implicit TLS)' | 'STARTTLS' {
  return (smtp.secure ?? smtp.port === 465) ? 'SMTPS (implicit TLS)' : 'STARTTLS';
}

export interface TestMessage {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * The test email itself: states which server, port, TLS mode and account sent it, so the person
 * reading it in the inbox can tell WHICH configuration worked (staging vs production, .env vs
 * Settings). No secrets — the password never appears.
 */
export function buildTestMessage(
  smtp: SmtpConfig,
  to: string,
  opts: { readonly subject?: string | undefined; readonly sentAt?: Date | undefined } = {},
): TestMessage {
  const sentAt = opts.sentAt ?? new Date();
  const subject = opts.subject ?? `Tes SMTP — ${smtp.fromName} (${sentAt.toISOString()})`;
  const rows: [string, string][] = [
    ['Server', `${smtp.host}:${smtp.port}`],
    ['TLS', tlsMode(smtp)],
    ['Autentikasi', smtp.user ? `user "${smtp.user}"` : 'tanpa autentikasi'],
    ['Pengirim', formatFrom(smtp)],
    ['Waktu', sentAt.toISOString()],
  ];
  const text = [
    'Email uji SMTP.',
    'Jika Anda membaca ini, konfigurasi SMTP berikut berhasil mengirim email:',
    '',
    ...rows.map(([k, v]) => `${k.padEnd(12)} ${v}`),
    '',
    'Dikirim oleh `bun run mail:test` — abaikan jika tidak Anda kenali.',
  ].join('\n');
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e4e4e7">
<h1 style="font-size:18px;margin:0 0 8px">Email uji SMTP</h1>
<p style="margin:0 0 16px;color:#52525b">Jika Anda membaca ini, konfigurasi SMTP berikut berhasil mengirim email.</p>
<table style="border-collapse:collapse;width:100%;font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 8px;border-top:1px solid #e4e4e7;color:#71717a;white-space:nowrap">${esc(k)}</td><td style="padding:6px 8px;border-top:1px solid #e4e4e7"><code>${esc(v)}</code></td></tr>`,
  )
  .join('\n')}
</table>
<p style="margin:16px 0 0;font-size:12px;color:#a1a1aa">Dikirim oleh <code>bun run mail:test</code> — abaikan jika tidak Anda kenali.</p>
</div></body></html>`;
  return { to, from: formatFrom(smtp), subject, text, html };
}

export interface TestSendResult {
  readonly messageId: string;
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
  readonly response: string;
}

/** The one method the tester needs from a transport — a real `Transporter` or a fake in tests. */
export interface MailSender {
  sendMail(msg: TestMessage): Promise<unknown>;
}

export interface SendTestOptions extends TransportOptions {
  readonly subject?: string | undefined;
  /** Injectable for tests; defaults to a real transport for `smtp`. */
  readonly transport?: MailSender | undefined;
}

/** Send one test email through `smtp`. Throws nodemailer's error (with `code`) on failure. */
export async function sendTestEmail(
  smtp: SmtpConfig,
  to: string,
  opts: SendTestOptions = {},
): Promise<TestSendResult> {
  const transport = opts.transport ?? createSmtpTransport(smtp, opts);
  const msg = buildTestMessage(smtp, to, { subject: opts.subject });
  const info = (await transport.sendMail(msg)) as {
    messageId?: string;
    accepted?: (string | { address: string })[];
    rejected?: (string | { address: string })[];
    response?: string;
  };
  const addr = (a: string | { address: string }) => (typeof a === 'string' ? a : a.address);
  return {
    messageId: info.messageId ?? '',
    accepted: (info.accepted ?? []).map(addr),
    rejected: (info.rejected ?? []).map(addr),
    response: info.response ?? '',
  };
}

/**
 * What to try next for a nodemailer/SMTP error — the codes and phrases that actually show up
 * when SMTP is misconfigured. Returns [] when there is nothing specific to say.
 */
export function smtpHints(err: unknown): string[] {
  const e = err as { code?: string; responseCode?: number; message?: string; command?: string };
  const code = e?.code ?? '';
  const rc = e?.responseCode ?? 0;
  const msg = (e?.message ?? String(err)).toLowerCase();
  const hints: string[] = [];
  if (code === 'EAUTH' || rc === 535 || rc === 534) {
    hints.push(
      'SMTP_USER / SMTP_PASSWORD ditolak server. Gmail & Google Workspace butuh App Password (bukan sandi akun); Outlook/M365 sering mensyaratkan SMTP AUTH diaktifkan per mailbox.',
      'Beberapa provider memakai alamat email lengkap sebagai SMTP_USER.',
    );
  }
  if (code === 'EDNS' || msg.includes('enotfound') || msg.includes('getaddrinfo')) {
    hints.push('SMTP_HOST tidak bisa di-resolve — periksa ejaan host dan DNS di mesin ini.');
  }
  if (code === 'ECONNECTION' || code === 'ECONNREFUSED' || msg.includes('econnrefused')) {
    hints.push(
      'Koneksi ditolak: SMTP_PORT salah atau server tidak mendengarkan di port itu (587 STARTTLS, 465 SMTPS, 25 plain).',
    );
  }
  if (code === 'ETIMEDOUT' || msg.includes('timeout') || msg.includes('timed out')) {
    hints.push(
      'Time-out: firewall/VPS memblokir port keluar (banyak VPS memblokir 25, beberapa juga 465/587) — coba `nc -vz HOST PORT` dari mesin yang sama.',
    );
  }
  if (
    msg.includes('wrong version number') ||
    msg.includes('ssl3_get_record') ||
    msg.includes('packet length too long') ||
    (code === 'ESOCKET' && msg.includes('ssl'))
  ) {
    hints.push(
      'Mode TLS tidak cocok dengan port: paksa dengan SMTP_SECURE=true (SMTPS, biasanya 465) atau SMTP_SECURE=false (STARTTLS, biasanya 587).',
    );
  }
  if (msg.includes('greeting never received')) {
    hints.push(
      'Server tidak menyapa: umumnya SMTPS dipaksa ke port STARTTLS (atau sebaliknya) — cek SMTP_SECURE — atau port disaring firewall.',
    );
  }
  if (msg.includes('self signed') || msg.includes('self-signed') || msg.includes('certificate')) {
    hints.push(
      'Sertifikat TLS server tidak valid untuk host ini — pakai nama host yang tercantum di sertifikat (bukan IP) atau perbaiki sertifikat di server.',
    );
  }
  if (code === 'EENVELOPE' || rc === 550 || rc === 553 || rc === 554) {
    hints.push(
      'Amplop ditolak: MAIL_FROM_ADDRESS harus alamat/domain yang diizinkan provider (domain terverifikasi, atau sama dengan SMTP_USER), dan penerima harus valid.',
    );
  }
  if (rc === 421 || rc === 450 || rc === 451 || rc === 452) {
    hints.push(
      'Server menolak sementara (4xx) — batas laju atau greylisting; coba lagi beberapa menit.',
    );
  }
  return hints;
}
