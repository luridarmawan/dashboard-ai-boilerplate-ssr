import { errorResponses, OkSchema, ok, PageSchema, page } from '@core/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  or,
  type SQL,
  schema,
  sql,
  unsafeAcrossTenants,
} from '@core/db';
import { retryOutbox } from '@core/mail';
import { Elysia, t } from 'elysia';
import { Id, likePattern, MAX_LIMIT, paging } from '../lib/http.ts';
import { runOutboxOnce } from '../mail.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';

/** Outbox administration (J-2): see what was sent, what failed, retry, run the worker now. */
const Row = t.Object({
  id: t.String(),
  clientId: t.Nullable(t.String()),
  to: t.String(),
  toName: t.Nullable(t.String()),
  subject: t.String(),
  template: t.String(),
  locale: t.String(),
  status: t.String(),
  attempts: t.Integer(),
  transport: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  nextAttemptAt: t.Nullable(t.String()),
  sentAt: t.Nullable(t.String()),
  createdAt: t.String(),
});

const STATUSES = ['pending', 'sending', 'sent', 'failed'] as const;

/** Sortable columns; anything else falls back to the default (newest first). */
const SORTS = {
  created: schema.outboxEmail.created_at,
  sent: schema.outboxEmail.sent_at,
  status: schema.outboxEmail.status,
  to: schema.outboxEmail.to_address,
  subject: schema.outboxEmail.subject,
  template: schema.outboxEmail.template,
  attempts: schema.outboxEmail.attempts,
} as const;

/**
 * `?from=`/`?to=` are calendar days (`YYYY-MM-DD`) read in the server's zone, `to` inclusive —
 * an operator asking for "11 September" means the whole day, not midnight.
 */
const DateOnly = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 });
function dayStart(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function dayEnd(v: string | undefined): Date | null {
  const d = dayStart(v);
  if (d) d.setHours(23, 59, 59, 999);
  return d;
}

const ListOutboxQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_LIMIT })),
  /** Free text over recipient (address and name) and subject. */
  q: t.Optional(t.String({ maxLength: 191 })),
  status: t.Optional(t.Union(STATUSES.map((s) => t.Literal(s)))),
  template: t.Optional(t.String({ maxLength: 64 })),
  from: t.Optional(DateOnly),
  to: t.Optional(DateOnly),
  sort: t.Optional(t.Union(Object.keys(SORTS).map((k) => t.Literal(k)))),
  order: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
});

export const outbox = new Elysia({ name: 'outbox', prefix: '/outbox', tags: ['mail'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ query }) => {
      const db = unsafeAcrossTenants(); // the outbox is global (password resets have no tenant)
      const p = paging(query, 50);
      const from = dayStart(query.from);
      const to = dayEnd(query.to);
      const conds: (SQL | undefined)[] = [
        query.status ? eq(schema.outboxEmail.status, query.status) : undefined,
        query.template ? eq(schema.outboxEmail.template, query.template) : undefined,
        from ? gte(schema.outboxEmail.created_at, from) : undefined,
        to ? lte(schema.outboxEmail.created_at, to) : undefined,
        p.q
          ? or(
              sql`lower(${schema.outboxEmail.to_address}) like ${likePattern(p.q)}`,
              sql`lower(${schema.outboxEmail.to_name}) like ${likePattern(p.q)}`,
              sql`lower(${schema.outboxEmail.subject}) like ${likePattern(p.q)}`,
            )
          : undefined,
      ];
      const active = conds.filter((c): c is SQL => c !== undefined);
      const where = active.length ? and(...active) : undefined;
      // Newest first unless asked otherwise: an outbox is read from its most recent row.
      const column = SORTS[query.sort ?? 'created'] ?? SORTS.created;
      const direction = (query.order ?? 'desc') === 'asc' ? asc : desc;
      const [tot] = await db.select({ n: count() }).from(schema.outboxEmail).where(where);
      const rows = await db
        .select()
        .from(schema.outboxEmail)
        .where(where)
        // A second key keeps paging stable when the first one ties (status, template, a null date).
        .orderBy(direction(column), desc(schema.outboxEmail.created_at))
        .limit(p.limit)
        .offset(p.offset);
      return page(
        rows.map((r) => ({
          id: r.id,
          clientId: r.client_id,
          to: r.to_address,
          toName: r.to_name,
          subject: r.subject,
          template: r.template,
          locale: r.locale,
          status: r.status,
          attempts: r.attempts,
          transport: r.transport,
          lastError: r.last_error,
          nextAttemptAt: r.next_attempt_at?.toISOString() ?? null,
          sentAt: r.sent_at?.toISOString() ?? null,
          createdAt: r.created_at.toISOString(),
        })),
        p.meta(Number(tot?.n ?? 0)),
      );
    },
    {
      beforeHandle: permission('mail.read'),
      query: ListOutboxQuery,
      response: { 200: PageSchema(Row), ...errorResponses },
      detail: {
        summary:
          'Outbox rows, newest first; filter by ?status, ?template and ?from/?to (day range), search recipient/subject with ?q',
      },
    },
  )
  .post(
    '/:id/retry',
    async ({ params }) => ok({ requeued: await retryOutbox(unsafeAcrossTenants(), [params.id]) }),
    {
      beforeHandle: permission('mail.manage'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ requeued: t.Integer() })), ...errorResponses },
      detail: { summary: 'Re-queue a failed email' },
    },
  )
  .post('/deliver', async () => ok(await runOutboxOnce()), {
    beforeHandle: permission('mail.manage'),
    response: {
      200: OkSchema(
        t.Object({
          picked: t.Integer(),
          sent: t.Integer(),
          failed: t.Integer(),
          deferred: t.Integer(),
        }),
      ),
      ...errorResponses,
    },
    detail: { summary: 'Run one worker pass now (the scheduler does this every minute)' },
  })
  .get(
    '/stats',
    async () => {
      const db = unsafeAcrossTenants();
      const [byStatus, byTemplate] = await Promise.all([
        db
          .select({ status: schema.outboxEmail.status, n: count() })
          .from(schema.outboxEmail)
          .groupBy(schema.outboxEmail.status),
        // The template list feeds the page's filter, so it comes from the data, not a hard-coded
        // list: a module that sends its own mail shows up without touching this route.
        db
          .select({ template: schema.outboxEmail.template, n: count() })
          .from(schema.outboxEmail)
          .groupBy(schema.outboxEmail.template)
          .orderBy(desc(count())),
      ]);
      const counts: Record<string, number> = { pending: 0, sending: 0, sent: 0, failed: 0 };
      for (const r of byStatus) counts[r.status] = Number(r.n);
      return ok({
        pending: counts.pending ?? 0,
        sending: counts.sending ?? 0,
        sent: counts.sent ?? 0,
        failed: counts.failed ?? 0,
        total: byStatus.reduce((n, r) => n + Number(r.n), 0),
        templates: byTemplate.map((r) => ({ template: r.template, count: Number(r.n) })),
      });
    },
    {
      beforeHandle: permission('mail.read'),
      response: {
        200: OkSchema(
          t.Object({
            pending: t.Integer(),
            sending: t.Integer(),
            sent: t.Integer(),
            failed: t.Integer(),
            total: t.Integer(),
            templates: t.Array(t.Object({ template: t.String(), count: t.Integer() })),
          }),
        ),
        ...errorResponses,
      },
      detail: { summary: 'Counts per status, plus the templates that appear in the outbox' },
    },
  );
