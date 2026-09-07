#!/usr/bin/env bun
/**
 * `bun run mail:test [--to alamat] [--subject teks] [--verify-only]`
 *
 * Kirim satu email uji memakai konfigurasi SMTP dari .env SAJA (SMTP_HOST/PORT/USER/PASSWORD/
 * SECURE, MAIL_FROM_ADDRESS/NAME) — tanpa database, tanpa outbox — supaya operator bisa
 * memastikan kredensial bekerja sebelum `dc up -d`. Dua langkah: `verify()` (koneksi + TLS +
 * autentikasi), lalu `sendMail()`. Gagal di langkah mana pun → petunjuk perbaikan + exit 1.
 *
 *   bun run mail:test                          # ke MAIL_FROM_ADDRESS
 *   bun run mail:test --to saya@contoh.id      # ke alamat lain
 *   bun --env-file=.env.prod run mail:test     # pakai .env lain
 *
 * Exit: 0 terkirim · 1 gagal (koneksi/auth/kirim) · 2 konfigurasi .env belum lengkap.
 */
import { parseArgs } from 'node:util';
import {
  createSmtpTransport,
  type SmtpConfig,
  sendTestEmail,
  smtpFromEnv,
  smtpHints,
  tlsMode,
} from '../src/index.ts';

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    to: { type: 'string', short: 't' },
    subject: { type: 'string', short: 's' },
    'verify-only': { type: 'boolean', default: false },
    timeout: { type: 'string', default: '15000' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(
    [
      'bun run mail:test [--to alamat] [--subject teks] [--verify-only] [--timeout ms]',
      '',
      'Kirim email uji dengan SMTP_* / MAIL_FROM_* dari .env (tanpa database).',
      '  --to, -t        penerima (default: MAIL_FROM_ADDRESS)',
      '  --subject, -s   subjek kustom',
      '  --verify-only   hanya cek koneksi + autentikasi, tidak mengirim',
      '  --timeout       batas tunggu koneksi/greeting/socket dalam ms (default 15000)',
      '',
      'File .env lain: bun --env-file=.env.prod run mail:test',
    ].join('\n'),
  );
  process.exit(0);
}

// Never echo any part of the password — only that it is set, and how long it is.
const mask = (s: string | null | undefined) =>
  s ? `${'•'.repeat(8)} (${s.length} karakter)` : '(kosong)';

let smtp: SmtpConfig | null;
try {
  smtp = smtpFromEnv(process.env);
} catch (err) {
  console.error(`✗ .env tidak valid: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
if (!smtp) {
  const missing = ['SMTP_HOST', 'MAIL_FROM_ADDRESS'].filter((k) => !process.env[k]?.trim());
  console.error(
    [
      `✗ SMTP belum dikonfigurasi di .env — ${missing.join(' dan ')} wajib diisi.`,
      '  Minimal:',
      '    SMTP_HOST=smtp.example.com',
      '    SMTP_PORT=587                 # 587 STARTTLS · 465 SMTPS',
      '    SMTP_USER=…',
      '    SMTP_PASSWORD=…',
      '    MAIL_FROM_ADDRESS=noreply@example.com',
      '    MAIL_FROM_NAME=Nama Aplikasi',
      '  Contoh lengkap ada di .env.example.',
    ].join('\n'),
  );
  process.exit(2);
}

const to = values.to ?? positionals[0] ?? smtp.fromAddress;
const timeoutMs = Number(values.timeout);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error(`✗ --timeout harus angka ms > 0, bukan "${values.timeout}"`);
  process.exit(2);
}

console.log('SMTP dari .env:');
console.log(`  host      ${smtp.host}:${smtp.port}  (${tlsMode(smtp)})`);
console.log(`  user      ${smtp.user ?? '(tanpa autentikasi)'}`);
console.log(`  password  ${smtp.user ? mask(smtp.password) : '-'}`);
console.log(`  from      "${smtp.fromName}" <${smtp.fromAddress}>`);
console.log(`  to        ${to}`);
console.log('');

function fail(step: string, err: unknown): never {
  const e = err as { code?: string; responseCode?: number; command?: string; message?: string };
  const detail = [e.code, e.responseCode, e.command].filter(Boolean).join(' · ');
  console.error(`✗ ${step} gagal${detail ? ` [${detail}]` : ''}: ${e.message ?? String(err)}`);
  const hints = smtpHints(err);
  if (hints.length) {
    console.error('');
    console.error('Yang bisa dicoba:');
    for (const h of hints) console.error(`  • ${h}`);
  }
  process.exit(1);
}

const transport = createSmtpTransport(smtp, { timeoutMs });
const t0 = performance.now();
try {
  await transport.verify();
} catch (err) {
  fail('Koneksi/autentikasi', err);
}
console.log(`✓ Koneksi, TLS, dan autentikasi OK (${Math.round(performance.now() - t0)} ms)`);

if (values['verify-only']) {
  transport.close();
  process.exit(0);
}

const t1 = performance.now();
try {
  const r = await sendTestEmail(smtp, to, { transport, subject: values.subject });
  console.log(`✓ Terkirim (${Math.round(performance.now() - t1)} ms)`);
  console.log(`  message-id  ${r.messageId || '(tidak ada)'}`);
  if (r.accepted.length) console.log(`  diterima    ${r.accepted.join(', ')}`);
  if (r.rejected.length) console.log(`  ditolak     ${r.rejected.join(', ')}`);
  if (r.response) console.log(`  respons     ${r.response}`);
  console.log('');
  console.log(`Periksa kotak masuk ${to} (termasuk folder spam).`);
} catch (err) {
  fail('Pengiriman', err);
} finally {
  transport.close();
}
