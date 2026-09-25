import {
  affectedRows as affected,
  and,
  asc,
  type Db,
  eq,
  inArray,
  isNull,
  lte,
  newId,
  or,
  schema,
} from '@core/db';
import { logger } from '@core/logger';
import { buildTestMessage, createSmtpTransport, formatFrom } from './smtp-test.ts';
import { type Brand, type Rendered, renderTemplate, type TemplateId } from './templates/index.ts';

export {
  buildTestMessage,
  createSmtpTransport,
  formatFrom,
  type MailSender,
  type SendTestOptions,
  sendTestEmail,
  smtpFromEnv,
  smtpHints,
  type TestMessage,
  type TestSendResult,
  type TransportOptions,
  tlsMode,
} from './smtp-test.ts';
export { type Brand, type Rendered, renderTemplate, type TemplateId } from './templates/index.ts';

/**
 * The outbox (PRD J-1, J-2). `enqueue()` is all a request does — one INSERT, no SMTP on the
 * request path. `deliverOutbox()` runs from the scheduler on every instance; the row lease is the
 * conditional UPDATE pending → sending, so N instances never send the same email twice. Failures
 * back off (1, 5, 15, 60 min…) and give up after `maxAttempts` with `status = failed`.
 */

export interface EnqueueInput {
  readonly to: string;
  readonly toName?: string | null;
  readonly template: TemplateId;
  readonly locale?: string;
  readonly data: Record<string, unknown>;
  readonly clientId?: string | null;
  /** Subject is rendered at send time from the template; a fixed one may still be forced. */
  readonly subject?: string;
}

export async function enqueueEmail(db: Db, input: EnqueueInput): Promise<string> {
  const id = newId();
  await db.insert(schema.outboxEmail).values({
    id,
    client_id: input.clientId ?? null,
    to_address: input.to.trim().toLowerCase(),
    to_name: input.toName ?? null,
    subject: input.subject ?? `[${input.template}]`,
    template: input.template,
    locale: input.locale ?? 'en',
    payload: input.data,
    status: 'pending',
    attempts: 0,
    next_attempt_at: new Date(),
  });
  logger.info('outbox: enqueued', { outboxId: id, template: input.template, to: input.to });
  return id;
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly user?: string | null;
  readonly password?: string | null;
  readonly fromName: string;
  readonly fromAddress: string;
  /** Implicit TLS (SMTPS). Default: true on port 465, STARTTLS otherwise. */
  readonly secure?: boolean;
  /**
   * Blind copy of EVERY message sent through this configuration (`MAIL_BCC`): an archive or a
   * compliance mailbox. Only the envelope carries it, so recipients never see the address.
   */
  readonly bcc?: string | null;
}

export interface DeliverOptions {
  readonly limit?: number;
  readonly maxAttempts?: number;
  /** SMTP settings from runtime configuration (mail.*); null = not configured. */
  readonly smtp: SmtpConfig | null;
  readonly brand: Brand;
  /** Without SMTP outside production, emails are "sent" to the log so flows stay testable. */
  readonly allowLogTransport: boolean;
  /** Injectable sender for tests. */
  readonly send?: (msg: OutboundMessage) => Promise<void>;
}

/** What one delivery hands the transport — nodemailer's `sendMail()` takes exactly this shape. */
export interface OutboundMessage {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Present only when the configuration in effect carries a `bcc` (MAIL_BCC). */
  readonly bcc?: string;
}

export interface DeliverResult {
  readonly picked: number;
  readonly sent: number;
  readonly failed: number;
  readonly deferred: number;
}

const BACKOFF_MIN = [1, 5, 15, 60, 240, 1440];

/**
 * The outbox row a Settings → Email test leaves behind. It is not a `TemplateId`: the tester
 * sends straight through SMTP and records the outcome here afterwards, so the outbox shows the
 * test next to real mail and can send it again. Rendering at (re)delivery describes the SMTP
 * configuration in effect AT THAT MOMENT — the body names the server that actually sent it.
 */
export const SMTP_TEST_TEMPLATE = 'smtp-test';

/** Payload of an `smtp-test` row: only what the body needs beyond the live configuration. */
export interface SmtpTestPayload {
  readonly sentBy?: string;
}

/** What the log transport (no SMTP outside production) pretends to be when a test is re-sent. */
const LOG_STAND_IN = (brand: Brand): SmtpConfig => ({
  host: 'log',
  port: 0,
  fromName: brand.appName,
  fromAddress: 'no-reply@localhost',
});

function renderSmtpTest(
  smtp: SmtpConfig | null,
  brand: Brand,
  to: string,
  payload: SmtpTestPayload,
): Rendered {
  const msg = buildTestMessage(smtp ?? LOG_STAND_IN(brand), to, { sentBy: payload.sentBy });
  return { subject: msg.subject, html: msg.html, text: msg.text };
}

export interface RecordTestEmailInput {
  readonly to: string;
  readonly subject: string;
  readonly clientId?: string | null;
  readonly sentBy: string;
  /** null = delivered; a message = what SMTP answered, and the row is `failed`. */
  readonly error: string | null;
}

/**
 * Write the outcome of a direct SMTP test into the outbox (J-2): `sent` or `failed`, one
 * attempt, transport `smtp`. Nothing is queued — the mail already went (or did not) — but the
 * row shows up on `/outbox` with the rest and can be re-sent from there like any other.
 */
export async function recordTestEmail(db: Db, input: RecordTestEmailInput): Promise<string> {
  const id = newId();
  const now = new Date();
  const payload: SmtpTestPayload = { sentBy: input.sentBy };
  await db.insert(schema.outboxEmail).values({
    id,
    client_id: input.clientId ?? null,
    to_address: input.to.trim().toLowerCase(),
    to_name: null,
    subject: input.subject,
    template: SMTP_TEST_TEMPLATE,
    locale: 'id',
    payload,
    status: input.error === null ? 'sent' : 'failed',
    attempts: 1,
    next_attempt_at: null,
    sent_at: input.error === null ? now : null,
    last_error: input.error?.slice(0, 2000) ?? null,
    transport: 'smtp',
  });
  return id;
}

export async function deliverOutbox(db: Db, opts: DeliverOptions): Promise<DeliverResult> {
  const now = new Date();
  const limit = opts.limit ?? 20;
  const maxAttempts = opts.maxAttempts ?? 6;
  const due = await db
    .select({ id: schema.outboxEmail.id })
    .from(schema.outboxEmail)
    .where(
      and(
        eq(schema.outboxEmail.status, 'pending'),
        or(
          isNull(schema.outboxEmail.next_attempt_at),
          lte(schema.outboxEmail.next_attempt_at, now),
        ),
      ),
    )
    .orderBy(asc(schema.outboxEmail.created_at))
    .limit(limit);
  if (!due.length) return { picked: 0, sent: 0, failed: 0, deferred: 0 };

  const transport = opts.smtp ? createSmtpTransport(opts.smtp) : null;
  const from = opts.smtp ? formatFrom(opts.smtp) : `"${opts.brand.appName}" <no-reply@localhost>`;
  const send =
    opts.send ??
    (async (msg) => {
      if (transport) {
        await transport.sendMail(msg);
        return;
      }
      if (!opts.allowLogTransport) throw new Error('SMTP belum dikonfigurasi (mail.smtp_host)');
      // Development stand-in: the rendered email goes to the log, links included, so the flow is testable.
      console.log(
        JSON.stringify({
          t: new Date().toISOString(),
          level: 'warn',
          msg: 'DEV ONLY: email (log transport)',
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
        }),
      );
    });

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  for (const { id } of due) {
    // Lease: only the instance that flips pending → sending owns this row.
    const claimed = await db
      .update(schema.outboxEmail)
      .set({ status: 'sending' })
      .where(and(eq(schema.outboxEmail.id, id), eq(schema.outboxEmail.status, 'pending')));
    if (affected(claimed) !== 1) continue;
    const [row] = await db
      .select()
      .from(schema.outboxEmail)
      .where(eq(schema.outboxEmail.id, id))
      .limit(1);
    if (!row) continue;
    const attempts = row.attempts + 1;
    try {
      const payload = (row.payload as Record<string, unknown>) ?? {};
      const rendered: Rendered =
        row.template === SMTP_TEST_TEMPLATE
          ? renderSmtpTest(opts.smtp, opts.brand, row.to_address, payload as SmtpTestPayload)
          : renderTemplate(row.template as TemplateId, row.locale, payload, opts.brand);
      await send({
        to: row.to_name ? `"${row.to_name.replace(/"/g, '')}" <${row.to_address}>` : row.to_address,
        from,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        // MAIL_BCC: the same blind copy on every message, added to the envelope only.
        ...(opts.smtp?.bcc ? { bcc: opts.smtp.bcc } : {}),
      });
      await db
        .update(schema.outboxEmail)
        .set({
          status: 'sent',
          attempts,
          sent_at: new Date(),
          last_error: null,
          subject: rendered.subject,
          transport: transport ? 'smtp' : 'log',
        })
        .where(eq(schema.outboxEmail.id, id));
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = attempts >= maxAttempts;
      const delayMin = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] ?? 60;
      await db
        .update(schema.outboxEmail)
        .set({
          status: giveUp ? 'failed' : 'pending',
          attempts,
          last_error: message.slice(0, 2000),
          next_attempt_at: giveUp ? null : new Date(Date.now() + delayMin * 60_000),
        })
        .where(eq(schema.outboxEmail.id, id));
      if (giveUp) failed++;
      else deferred++;
      logger.warn('outbox: send failed', { outboxId: id, attempts, giveUp, error: message });
    }
  }
  return { picked: due.length, sent, failed, deferred };
}

/**
 * Send again (admin action): a failed row gets another go, a delivered one goes out once more —
 * to the same recipient, re-rendered from its payload with the brand and SMTP in effect NOW.
 * The attempt counter restarts so the row has its full backoff budget again. A row that is
 * `sending` is leased by a worker this moment and is left alone; a `pending` row is simply
 * made due now.
 */
export async function resendOutbox(db: Db, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  const r = await db
    .update(schema.outboxEmail)
    .set({ status: 'pending', attempts: 0, next_attempt_at: new Date(), last_error: null })
    .where(
      and(
        inArray(schema.outboxEmail.id, [...ids]),
        inArray(schema.outboxEmail.status, ['pending', 'sent', 'failed']),
      ),
    );
  return affected(r);
}
