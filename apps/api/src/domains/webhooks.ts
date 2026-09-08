import { randomToken, writeAudit } from '@core/auth';
import {
  errorResponses,
  fail,
  Id,
  OkSchema,
  ok,
  WebhookBody,
  WebhookUpdateBody,
} from '@core/contracts';
import { and, desc, eq, isNull, newId, schema, unsafeAcrossTenants } from '@core/db';
import { CORE_EVENTS } from '@core/module-kit';
import { Elysia, t } from 'elysia';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';
import {
  attemptDelivery,
  eventsOf,
  sendTestPing,
  WEBHOOK_EVENTS,
  type WebhookRow,
} from '../webhooks.ts';

/**
 * Outgoing webhooks (PRD J-5): registrations are tenant data under `webhook.read|manage`; the
 * secret is returned exactly once at creation; deliveries are listed per webhook and a failed one
 * can be retried by hand. Events are the core bus events (or `*`).
 */
const WebhookView = t.Object({
  id: t.String(),
  name: t.String(),
  url: t.String(),
  events: t.Array(t.String()),
  enabled: t.Boolean(),
  lastStatus: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  lastDeliveredAt: t.Nullable(t.String()),
  createdAt: t.String(),
});
const DeliveryView = t.Object({
  id: t.String(),
  event: t.String(),
  status: t.String(),
  attempts: t.Integer(),
  responseStatus: t.Nullable(t.Integer()),
  lastError: t.Nullable(t.String()),
  nextAttemptAt: t.Nullable(t.String()),
  deliveredAt: t.Nullable(t.String()),
  createdAt: t.String(),
  payload: t.Unknown(),
});
const view = (w: WebhookRow) => ({
  id: w.id,
  name: w.name,
  url: w.url,
  events: eventsOf(w),
  enabled: w.enabled,
  lastStatus: w.last_status,
  lastError: w.last_error,
  lastDeliveredAt: w.last_delivered_at?.toISOString() ?? null,
  createdAt: w.created_at.toISOString(),
});
const deliveryView = (d: typeof schema.webhookDeliveries.$inferSelect) => ({
  id: d.id,
  event: d.event,
  status: d.status,
  attempts: d.attempts,
  responseStatus: d.response_status,
  lastError: d.last_error,
  nextAttemptAt: d.next_attempt_at?.toISOString() ?? null,
  deliveredAt: d.delivered_at?.toISOString() ?? null,
  createdAt: d.created_at.toISOString(),
  payload: d.payload,
});
const cleanEvents = (list: readonly string[]) => {
  const known = new Set<string>(WEBHOOK_EVENTS);
  const out = [...new Set(list.map((e) => e.trim()).filter((e) => known.has(e)))];
  return out.includes('*') ? ['*'] : out;
};

export const webhooksDomain = new Elysia({
  name: 'webhooks',
  prefix: '/webhooks',
  tags: ['webhooks'],
})
  .use(requestContext)
  .use(tenantContext)
  .get('/events', () => ok({ events: [...CORE_EVENTS] }), {
    beforeHandle: permission('webhook.read'),
    response: { 200: OkSchema(t.Object({ events: t.Array(t.String()) })), ...errorResponses },
    detail: { summary: 'Core event names a webhook can subscribe to (plus `*`)' },
  })
  .get(
    '/',
    async ({ tenantState }) => {
      const tenant = tenantState?.tenant;
      if (!tenant) return ok([]);
      const rows = await tenant.select(schema.webhooks, isNull(schema.webhooks.deleted_at));
      return ok(rows.sort((a, b) => a.name.localeCompare(b.name)).map(view));
    },
    {
      beforeHandle: permission('webhook.read'),
      response: { 200: OkSchema(t.Array(WebhookView)), ...errorResponses },
      detail: { summary: 'Outgoing webhooks of the active tenant (J-5)' },
    },
  )
  .post(
    '/',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      if (!tenant || !tenantState.clientId) {
        set.status = 409;
        return fail('conflict', 'Tidak ada tenant aktif', requestId);
      }
      const events = cleanEvents(body.events);
      if (!events.length) {
        set.status = 422;
        return fail('validation_failed', 'Pilih minimal satu event yang dikenal', requestId, {
          events: 'pilih minimal satu event yang dikenal',
        });
      }
      const id = newId();
      const secret = randomToken();
      await tenant.insert(schema.webhooks, {
        id,
        name: body.name.trim(),
        url: body.url.trim(),
        secret,
        events,
        enabled: body.enabled ?? true,
      });
      const row = (await tenant.selectOne(
        schema.webhooks,
        eq(schema.webhooks.id, id),
      )) as WebhookRow;
      await writeAudit(unsafeAcrossTenants(), {
        clientId: tenantState.clientId,
        actorId: a.user.id,
        action: 'webhook.create',
        resource: 'webhook',
        resourceId: id,
        ip: clientIp(request, server),
        requestId,
        after: { name: row.name, url: row.url, events, secret: '***' },
      });
      set.status = 201;
      // The secret leaves the server exactly once.
      return ok({ ...view(row), secret });
    },
    {
      beforeHandle: permission('webhook.manage'),
      body: WebhookBody,
      response: {
        201: OkSchema(t.Intersect([WebhookView, t.Object({ secret: t.String() })])),
        ...errorResponses,
      },
      detail: { summary: 'Register a webhook; the signing secret is returned once' },
    },
  )
  .get(
    '/:id',
    async ({ params, set, requestId, tenantState }) => {
      const tenant = tenantState?.tenant;
      const row = tenant
        ? await tenant.selectOne(
            schema.webhooks,
            and(eq(schema.webhooks.id, params.id), isNull(schema.webhooks.deleted_at)),
          )
        : null;
      if (!row || !tenant) {
        set.status = 404;
        return fail('not_found', 'Webhook tidak ditemukan', requestId);
      }
      const deliveries = await unsafeAcrossTenants() // tenant condition explicit; ordered + limited
        .select()
        .from(schema.webhookDeliveries)
        .where(
          and(
            eq(schema.webhookDeliveries.client_id, tenantState.clientId as string),
            eq(schema.webhookDeliveries.webhook_id, row.id),
          ),
        )
        .orderBy(desc(schema.webhookDeliveries.created_at))
        .limit(50);
      return ok({ ...view(row), deliveries: deliveries.map(deliveryView) });
    },
    {
      beforeHandle: permission('webhook.read'),
      params: t.Object({ id: Id }),
      response: {
        200: OkSchema(t.Intersect([WebhookView, t.Object({ deliveries: t.Array(DeliveryView) })])),
        ...errorResponses,
      },
      detail: { summary: 'One webhook with its last 50 deliveries' },
    },
  )
  .put(
    '/:id',
    async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      const row = tenant
        ? await tenant.selectOne(
            schema.webhooks,
            and(eq(schema.webhooks.id, params.id), isNull(schema.webhooks.deleted_at)),
          )
        : null;
      if (!row || !tenant || !tenantState.clientId) {
        set.status = 404;
        return fail('not_found', 'Webhook tidak ditemukan', requestId);
      }
      const patch: Partial<typeof schema.webhooks.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.url !== undefined) patch.url = body.url.trim();
      if (body.events !== undefined) {
        const events = cleanEvents(body.events);
        if (!events.length) {
          set.status = 422;
          return fail('validation_failed', 'Pilih minimal satu event yang dikenal', requestId, {
            events: 'pilih minimal satu event yang dikenal',
          });
        }
        patch.events = events;
      }
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (Object.keys(patch).length)
        await tenant.update(schema.webhooks, patch, eq(schema.webhooks.id, row.id));
      const after = (await tenant.selectOne(
        schema.webhooks,
        eq(schema.webhooks.id, row.id),
      )) as WebhookRow;
      await writeAudit(unsafeAcrossTenants(), {
        clientId: tenantState.clientId,
        actorId: a.user.id,
        action: 'webhook.update',
        resource: 'webhook',
        resourceId: row.id,
        ip: clientIp(request, server),
        requestId,
        before: view(row),
        after: view(after),
      });
      return ok(view(after));
    },
    {
      beforeHandle: permission('webhook.manage'),
      params: t.Object({ id: Id }),
      body: WebhookUpdateBody,
      response: { 200: OkSchema(WebhookView), ...errorResponses },
      detail: { summary: 'Update name, URL, events or enabled' },
    },
  )
  .post(
    '/:id/rotate-secret',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      const row = tenant
        ? await tenant.selectOne(
            schema.webhooks,
            and(eq(schema.webhooks.id, params.id), isNull(schema.webhooks.deleted_at)),
          )
        : null;
      if (!row || !tenant || !tenantState.clientId) {
        set.status = 404;
        return fail('not_found', 'Webhook tidak ditemukan', requestId);
      }
      const secret = randomToken();
      await tenant.update(schema.webhooks, { secret }, eq(schema.webhooks.id, row.id));
      await writeAudit(unsafeAcrossTenants(), {
        clientId: tenantState.clientId,
        actorId: a.user.id,
        action: 'webhook.rotate_secret',
        resource: 'webhook',
        resourceId: row.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({ secret });
    },
    {
      beforeHandle: permission('webhook.manage'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ secret: t.String() })), ...errorResponses },
      detail: { summary: 'Replace the signing secret; the new one is returned once' },
    },
  )
  .post(
    '/:id/test',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      const row = tenant
        ? await tenant.selectOne(
            schema.webhooks,
            and(eq(schema.webhooks.id, params.id), isNull(schema.webhooks.deleted_at)),
          )
        : null;
      if (!row || !tenant || !tenantState.clientId) {
        set.status = 404;
        return fail('not_found', 'Webhook tidak ditemukan', requestId);
      }
      const r = await sendTestPing(row);
      await tenant.update(
        schema.webhooks,
        { last_status: r.ok ? 'ok' : 'error', last_error: r.error },
        eq(schema.webhooks.id, row.id),
      );
      await writeAudit(unsafeAcrossTenants(), {
        clientId: tenantState.clientId,
        actorId: a.user.id,
        action: 'webhook.test',
        resource: 'webhook',
        resourceId: row.id,
        ip: clientIp(request, server),
        requestId,
        after: r,
      });
      return ok(r);
    },
    {
      beforeHandle: permission('webhook.manage'),
      params: t.Object({ id: Id }),
      response: {
        200: OkSchema(
          t.Object({
            ok: t.Boolean(),
            status: t.Nullable(t.Integer()),
            error: t.Nullable(t.String()),
            ms: t.Integer(),
          }),
        ),
        ...errorResponses,
      },
      detail: { summary: 'Send a signed `webhook.test` ping now and report the response' },
    },
  )
  .post(
    '/:id/deliveries/:deliveryId/retry',
    async ({ params, set, requestId, tenantState }) => {
      const tenant = tenantState?.tenant;
      const row = tenant
        ? await tenant.selectOne(
            schema.webhooks,
            and(eq(schema.webhooks.id, params.id), isNull(schema.webhooks.deleted_at)),
          )
        : null;
      const d = row
        ? await tenant?.selectOne(
            schema.webhookDeliveries,
            and(
              eq(schema.webhookDeliveries.id, params.deliveryId),
              eq(schema.webhookDeliveries.webhook_id, row.id),
            ),
          )
        : null;
      if (!row || !d) {
        set.status = 404;
        return fail('not_found', 'Pengiriman tidak ditemukan', requestId);
      }
      const outcome = await attemptDelivery(d, row);
      const after = await unsafeAcrossTenants()
        .select()
        .from(schema.webhookDeliveries)
        .where(eq(schema.webhookDeliveries.id, d.id))
        .limit(1);
      return ok({ outcome, delivery: deliveryView(after[0] as typeof d) });
    },
    {
      beforeHandle: permission('webhook.manage'),
      params: t.Object({ id: Id, deliveryId: Id }),
      response: {
        200: OkSchema(t.Object({ outcome: t.String(), delivery: DeliveryView })),
        ...errorResponses,
      },
      detail: { summary: 'Attempt one delivery again right now' },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      const row = tenant
        ? await tenant.selectOne(
            schema.webhooks,
            and(eq(schema.webhooks.id, params.id), isNull(schema.webhooks.deleted_at)),
          )
        : null;
      if (!row || !tenant || !tenantState.clientId) {
        set.status = 404;
        return fail('not_found', 'Webhook tidak ditemukan', requestId);
      }
      await tenant.update(
        schema.webhooks,
        { deleted_at: new Date(), enabled: false },
        eq(schema.webhooks.id, row.id),
      );
      await writeAudit(unsafeAcrossTenants(), {
        clientId: tenantState.clientId,
        actorId: a.user.id,
        action: 'webhook.delete',
        resource: 'webhook',
        resourceId: row.id,
        ip: clientIp(request, server),
        requestId,
        before: view(row),
      });
      return ok({ deleted: true as const });
    },
    {
      beforeHandle: permission('webhook.manage'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
      detail: { summary: 'Remove a webhook (pending deliveries stop)' },
    },
  );
