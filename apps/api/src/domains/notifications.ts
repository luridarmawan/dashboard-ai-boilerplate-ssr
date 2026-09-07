import { errorResponses, fail, Id, OkSchema, ok } from '@core/contracts';
import { and, eq, isNull, newId, schema } from '@core/db';
import { Elysia, t } from 'elysia';
import type { AuthState } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { tenantContext } from '../plugins/tenancy.ts';

/**
 * My notifications (PRD J-4): list, unread count, mark one / all read. Always scoped to the
 * caller AND the active tenant — a notification never crosses either boundary.
 */
const View = t.Object({
  id: t.String(),
  type: t.String(),
  title: t.String(),
  body: t.Nullable(t.String()),
  link: t.Nullable(t.String()),
  readAt: t.Nullable(t.String()),
  createdAt: t.String(),
});
type Row = typeof schema.notifications.$inferSelect;
const view = (n: Row) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.read_at?.toISOString() ?? null,
  createdAt: n.created_at.toISOString(),
});

const requireSession = ({
  auth,
  set,
  request,
}: {
  auth: unknown;
  set: { status?: number | string; headers: Record<string, string | number | undefined> };
  request: Request;
}) => {
  if (auth) return undefined;
  const rid = String(set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId());
  set.status = 401;
  return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', rid);
};

export const notificationsDomain = new Elysia({
  name: 'notifications',
  prefix: '/notifications',
  tags: ['notifications'],
})
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ auth, query, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      if (!tenant) return ok({ items: [], unread: 0 });
      const rows = await tenant.select(
        schema.notifications,
        and(
          eq(schema.notifications.user_id, a.user.id),
          query.unread === '1' ? isNull(schema.notifications.read_at) : undefined,
        ),
      );
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? 30)));
      const sorted = rows.sort((x, y) => y.created_at.getTime() - x.created_at.getTime());
      return ok({
        items: sorted.slice(0, limit).map(view),
        unread: rows.filter((r) => r.read_at === null).length,
      });
    },
    {
      beforeHandle: requireSession,
      query: t.Object({ unread: t.Optional(t.String()), limit: t.Optional(t.String()) }),
      response: {
        200: OkSchema(t.Object({ items: t.Array(View), unread: t.Integer() })),
        ...errorResponses,
      },
      detail: {
        summary: 'My notifications in the active tenant, newest first (?unread=1 to filter)',
      },
    },
  )
  .get(
    '/count',
    async ({ auth, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      if (!tenant) return ok({ unread: 0 });
      const rows = await tenant.select(
        schema.notifications,
        and(eq(schema.notifications.user_id, a.user.id), isNull(schema.notifications.read_at)),
      );
      return ok({ unread: rows.length });
    },
    {
      beforeHandle: requireSession,
      response: { 200: OkSchema(t.Object({ unread: t.Integer() })), ...errorResponses },
      detail: { summary: 'Unread count for the bell' },
    },
  )
  .put(
    '/:id/read',
    async ({ auth, params, set, requestId, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      const n = tenant
        ? await tenant.update(
            schema.notifications,
            { read_at: new Date() },
            and(
              eq(schema.notifications.id, params.id),
              eq(schema.notifications.user_id, a.user.id),
              isNull(schema.notifications.read_at),
            ),
          )
        : 0;
      if (!n) {
        // Already read or not mine: idempotent success when it exists and is mine, 404 otherwise.
        const mine = tenant
          ? await tenant.selectOne(
              schema.notifications,
              and(
                eq(schema.notifications.id, params.id),
                eq(schema.notifications.user_id, a.user.id),
              ),
            )
          : null;
        if (!mine) {
          set.status = 404;
          return fail('not_found', 'Notifikasi tidak ditemukan', requestId);
        }
      }
      return ok({ read: true as const });
    },
    {
      beforeHandle: requireSession,
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ read: t.Literal(true) })), ...errorResponses },
      detail: { summary: 'Mark one of my notifications read (idempotent)' },
    },
  )
  .post(
    '/read-all',
    async ({ auth, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      const n = tenant
        ? await tenant.update(
            schema.notifications,
            { read_at: new Date() },
            and(eq(schema.notifications.user_id, a.user.id), isNull(schema.notifications.read_at)),
          )
        : 0;
      return ok({ marked: Number(n) });
    },
    {
      beforeHandle: requireSession,
      response: { 200: OkSchema(t.Object({ marked: t.Integer() })), ...errorResponses },
      detail: { summary: 'Mark all my notifications in this tenant read' },
    },
  )
  .get(
    '/:id',
    async ({ auth, params, set, requestId, tenantState }) => {
      const a = auth as AuthState;
      const row = tenantState?.tenant
        ? await tenantState.tenant.selectOne(
            schema.notifications,
            and(
              eq(schema.notifications.id, params.id),
              eq(schema.notifications.user_id, a.user.id),
            ),
          )
        : null;
      if (!row) {
        set.status = 404;
        return fail('not_found', 'Notifikasi tidak ditemukan', requestId);
      }
      return ok(view(row));
    },
    {
      beforeHandle: requireSession,
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(View), ...errorResponses },
      detail: { summary: 'One of my notifications' },
    },
  );
