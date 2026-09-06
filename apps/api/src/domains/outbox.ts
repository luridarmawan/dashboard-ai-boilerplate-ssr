import { errorResponses, OkSchema, ok, PageSchema, page } from '@core/contracts';
import { count, desc, eq, schema, unsafeAcrossTenants } from '@core/db';
import { retryOutbox } from '@core/mail';
import { Elysia, t } from 'elysia';
import { Id, ListQuery, paging } from '../lib/http.ts';
import { runOutboxOnce } from '../mail.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';

/** Outbox administration (J-2): see what was sent, what failed, retry, run the worker now. */
const Row = t.Object({
  id: t.String(),
  to: t.String(),
  subject: t.String(),
  template: t.String(),
  status: t.String(),
  attempts: t.Integer(),
  lastError: t.Nullable(t.String()),
  sentAt: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const outbox = new Elysia({ name: 'outbox', prefix: '/outbox', tags: ['mail'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ query }) => {
      const db = unsafeAcrossTenants(); // the outbox is global (password resets have no tenant)
      const p = paging(query);
      const where = query.q ? eq(schema.outboxEmail.status, query.q) : undefined;
      const [tot] = await db.select({ n: count() }).from(schema.outboxEmail).where(where);
      const rows = await db
        .select()
        .from(schema.outboxEmail)
        .where(where)
        .orderBy(desc(schema.outboxEmail.created_at))
        .limit(p.limit)
        .offset(p.offset);
      return page(
        rows.map((r) => ({
          id: r.id,
          to: r.to_address,
          subject: r.subject,
          template: r.template,
          status: r.status,
          attempts: r.attempts,
          lastError: r.last_error,
          sentAt: r.sent_at?.toISOString() ?? null,
          createdAt: r.created_at.toISOString(),
        })),
        p.meta(Number(tot?.n ?? 0)),
      );
    },
    {
      beforeHandle: permission('mail.read'),
      query: ListQuery,
      response: { 200: PageSchema(Row), ...errorResponses },
      detail: { summary: 'Outbox rows, newest first; ?q=<status> filters by status' },
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
      const rows = await db
        .select({ status: schema.outboxEmail.status, n: count() })
        .from(schema.outboxEmail)
        .groupBy(schema.outboxEmail.status);
      const out: Record<string, number> = { pending: 0, sending: 0, sent: 0, failed: 0 };
      for (const r of rows) out[r.status] = Number(r.n);
      return ok(out);
    },
    {
      beforeHandle: permission('mail.read'),
      response: { 200: OkSchema(t.Record(t.String(), t.Integer())), ...errorResponses },
      detail: { summary: 'Counts per status' },
    },
  );
