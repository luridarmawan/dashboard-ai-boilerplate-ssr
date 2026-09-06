import { and, asc, type Db, eq, inArray, isNull, lte, newId, or, schema } from '@core/db';
import { logger } from '@core/logger';
import nodemailer from 'nodemailer';
import { type Brand, type Rendered, renderTemplate, type TemplateId } from './templates/index.ts';

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
    locale: input.locale ?? 'id',
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
  readonly send?: (msg: {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
  }) => Promise<void>;
}

export interface DeliverResult {
  readonly picked: number;
  readonly sent: number;
  readonly failed: number;
  readonly deferred: number;
}

const BACKOFF_MIN = [1, 5, 15, 60, 240, 1440];

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

  const transport = opts.smtp
    ? nodemailer.createTransport({
        host: opts.smtp.host,
        port: opts.smtp.port,
        secure: opts.smtp.port === 465,
        ...(opts.smtp.user
          ? { auth: { user: opts.smtp.user, pass: opts.smtp.password ?? '' } }
          : {}),
      })
    : null;
  const from = opts.smtp
    ? `"${opts.smtp.fromName.replace(/"/g, '')}" <${opts.smtp.fromAddress}>`
    : `"${opts.brand.appName}" <no-reply@localhost>`;
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
      const rendered: Rendered = renderTemplate(
        row.template as TemplateId,
        row.locale,
        (row.payload as Record<string, unknown>) ?? {},
        opts.brand,
      );
      await send({
        to: row.to_name ? `"${row.to_name.replace(/"/g, '')}" <${row.to_address}>` : row.to_address,
        from,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
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

/** Re-queue failed rows (admin action). */
export async function retryOutbox(db: Db, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  const r = await db
    .update(schema.outboxEmail)
    .set({ status: 'pending', next_attempt_at: new Date(), last_error: null })
    .where(and(inArray(schema.outboxEmail.id, [...ids]), eq(schema.outboxEmail.status, 'failed')));
  return affected(r);
}

function affected(result: unknown): number {
  if (Array.isArray(result))
    return Number((result[0] as { affectedRows?: number })?.affectedRows ?? 0);
  return Number((result as { count?: number })?.count ?? 0);
}
