import { writeAudit } from '@core/auth';
import { errorResponses, fail, Id, OkSchema, ok } from '@core/contracts';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  type SQL,
  schema,
  unsafeAcrossTenants,
} from '@core/db';
import { Elysia, t } from 'elysia';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';
import { listTasks, type QueueRow, retryJob } from '../queue.ts';

/**
 * Job queue admin (PRD P2): see what is pending, running, done and dead-lettered; retry or delete.
 * Scope: a superadmin sees every row; anyone else sees the active tenant's rows plus tenant-less
 * ones (system work), under `queue.read`; `queue.manage` may retry and delete.
 */
const JobView = t.Object({
  id: t.String(),
  name: t.String(),
  status: t.String(),
  priority: t.Integer(),
  attempts: t.Integer(),
  maxAttempts: t.Integer(),
  clientId: t.Nullable(t.String()),
  runAt: t.String(),
  startedAt: t.Nullable(t.String()),
  finishedAt: t.Nullable(t.String()),
  lockedBy: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  dedupeKey: t.Nullable(t.String()),
  requestId: t.Nullable(t.String()),
  payload: t.Unknown(),
  result: t.Unknown(),
  createdAt: t.String(),
});
const view = (r: QueueRow) => ({
  id: r.id,
  name: r.name,
  status: r.status,
  priority: r.priority,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  clientId: r.client_id,
  runAt: r.run_at.toISOString(),
  startedAt: r.started_at?.toISOString() ?? null,
  finishedAt: r.finished_at?.toISOString() ?? null,
  lockedBy: r.locked_by,
  lastError: r.last_error,
  dedupeKey: r.dedupe_key,
  requestId: r.request_id,
  payload: r.payload,
  result: r.result,
  createdAt: r.created_at.toISOString(),
});
const STATUSES = ['pending', 'running', 'done', 'dead'] as const;

function actor(auth: AuthState | null): AuthState {
  if (!auth) throw new Error('guard missing');
  return auth;
}
/** Tenant scope of the caller: null = everything (superadmin). */
function scopeOf(a: AuthState, clientId: string | null): SQL | undefined {
  if (a.user.is_superadmin) return undefined;
  return clientId
    ? or(eq(schema.queueJobs.client_id, clientId), isNull(schema.queueJobs.client_id))
    : isNull(schema.queueJobs.client_id);
}

export const queueDomain = new Elysia({ name: 'queue', prefix: '/queue', tags: ['queue'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ auth, query, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const conds: (SQL | undefined)[] = [scopeOf(a, tenantState?.clientId ?? null)];
      if (query.status) conds.push(eq(schema.queueJobs.status, query.status));
      if (query.name) conds.push(eq(schema.queueJobs.name, query.name));
      const where = conds.filter((c): c is SQL => c !== undefined);
      const filter = where.length ? and(...where) : undefined;
      // A queue is the one table that grows on its own, so the admin page reads it a page at a
      // time (`?page`) and the total comes from the database, not from the rows in hand.
      const limit = Math.min(200, Math.max(1, Number(query.limit ?? 100)));
      const page = Math.max(1, Math.floor(Number(query.page ?? 1)) || 1);
      const rows = await db
        .select()
        .from(schema.queueJobs)
        .where(filter)
        .orderBy(desc(schema.queueJobs.created_at))
        .limit(limit)
        .offset((page - 1) * limit);
      const [totalRow] = await db.select({ n: count() }).from(schema.queueJobs).where(filter);
      const total = Number(totalRow?.n ?? 0);
      // Counts per status in the same scope, aggregated BY THE DATABASE: the old version pulled
      // every job row into memory just to tally four numbers, which grew with the queue itself.
      const grouped = await db
        .select({ status: schema.queueJobs.status, n: count() })
        .from(schema.queueJobs)
        .where(scopeOf(a, tenantState?.clientId ?? null))
        .groupBy(schema.queueJobs.status);
      const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<string, number>;
      for (const r of grouped) counts[r.status] = Number(r.n);
      return ok({
        jobs: rows.map(view),
        counts,
        meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        tasks: listTasks().map((tk) => ({
          name: tk.name,
          module: tk.module,
          maxAttempts: tk.maxAttempts ?? 5,
          timeoutMs: tk.timeoutMs ?? 60_000,
          description: tk.description ?? null,
        })),
      });
    },
    {
      beforeHandle: permission('queue.read'),
      query: t.Object({
        status: t.Optional(t.Union(STATUSES.map((s) => t.Literal(s)))),
        name: t.Optional(t.String({ maxLength: 128 })),
        limit: t.Optional(t.String()),
        page: t.Optional(t.String()),
      }),
      response: {
        200: OkSchema(
          t.Object({
            jobs: t.Array(JobView),
            counts: t.Record(t.String(), t.Integer()),
            meta: t.Object({
              page: t.Integer(),
              limit: t.Integer(),
              total: t.Integer(),
              totalPages: t.Integer(),
            }),
            tasks: t.Array(
              t.Object({
                name: t.String(),
                module: t.String(),
                maxAttempts: t.Integer(),
                timeoutMs: t.Integer(),
                description: t.Nullable(t.Object({ id: t.String(), en: t.String() })),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
      detail: {
        summary:
          'Queue jobs in my scope (?status=, ?name=, ?limit=), counts per status, and the registered tasks',
      },
    },
  )
  .post(
    '/:id/retry',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const [row] = await db
        .select()
        .from(schema.queueJobs)
        .where(and(eq(schema.queueJobs.id, params.id), scopeOf(a, tenantState?.clientId ?? null)))
        .limit(1);
      if (!row) {
        set.status = 404;
        return fail('not_found', 'Pekerjaan tidak ditemukan', requestId);
      }
      if (!(await retryJob(row.id))) {
        set.status = 409;
        return fail('conflict', 'Hanya pekerjaan dead (atau pending) yang bisa diulang', requestId);
      }
      await writeAudit(db, {
        clientId: row.client_id,
        actorId: a.user.id,
        action: 'queue.retry',
        resource: 'queue_job',
        resourceId: row.id,
        ip: clientIp(request, server),
        requestId,
        after: { name: row.name, attempts: row.attempts },
      });
      return ok({ retried: true as const });
    },
    {
      beforeHandle: permission('queue.manage'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ retried: t.Literal(true) })), ...errorResponses },
      detail: { summary: 'Put a dead-lettered job back in the queue (attempts reset)' },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const [row] = await db
        .select()
        .from(schema.queueJobs)
        .where(and(eq(schema.queueJobs.id, params.id), scopeOf(a, tenantState?.clientId ?? null)))
        .limit(1);
      if (!row) {
        set.status = 404;
        return fail('not_found', 'Pekerjaan tidak ditemukan', requestId);
      }
      if (row.status === 'running') {
        set.status = 409;
        return fail('conflict', 'Pekerjaan sedang berjalan', requestId);
      }
      await db
        .delete(schema.queueJobs)
        .where(
          and(
            eq(schema.queueJobs.id, row.id),
            inArray(schema.queueJobs.status, ['pending', 'done', 'dead']),
          ),
        );
      await writeAudit(db, {
        clientId: row.client_id,
        actorId: a.user.id,
        action: 'queue.delete',
        resource: 'queue_job',
        resourceId: row.id,
        ip: clientIp(request, server),
        requestId,
        before: { name: row.name, status: row.status },
      });
      return ok({ deleted: true as const });
    },
    {
      beforeHandle: permission('queue.manage'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
      detail: { summary: 'Remove a pending, done or dead job' },
    },
  );
