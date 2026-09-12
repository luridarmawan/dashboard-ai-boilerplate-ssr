import { and, asc, eq, isNull, lte, newId, or, schema, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { CORE_EVENTS, type CoreEventName } from '@core/module-kit';
import { metrics } from './metrics.ts';

/**
 * Outgoing webhooks (PRD J-5): core events → signed JSON POSTs to the URLs a tenant registered.
 *
 *   enqueue      the bus subscriber (runtime.ts) turns every tenant event into one pending
 *                delivery row per matching, enabled webhook — the request path never waits on HTTP
 *   deliver      `core.webhooks.deliver` (every minute) and a nudge right after enqueue POST the due
 *                rows; a non-2xx or network error schedules a retry (1m, 5m, 30m, 2h, 12h), then
 *                the row is marked `failed`
 *   signature    `X-CRK-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")` so a receiver
 *                can verify origin and freshness; the secret is only ever shown at creation
 *
 * Events without a tenant (`system.ping`, config/user events with `clientId: null`) are not
 * dispatched: webhooks belong to tenants.
 */

export type WebhookRow = typeof schema.webhooks.$inferSelect;
export type DeliveryRow = typeof schema.webhookDeliveries.$inferSelect;

/** Retry schedule in seconds after attempt n (index = attempts made so far). */
export const RETRY_SCHEDULE_S: readonly number[] = [60, 300, 1800, 7200, 43_200];
export const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = 'crk-webhooks/1.0';

const sentTotal = metrics.counter(
  'webhook_deliveries_total',
  'Webhook delivery attempts by outcome.',
  ['status'],
);

export const WEBHOOK_EVENTS: readonly string[] = ['*', ...CORE_EVENTS];

/** The tenant an event concerns, when it concerns one. */
export function clientIdOf(event: CoreEventName, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof p[k] === 'string' && p[k] ? (p[k] as string) : null);
  if (event === 'tenant.switched') return pick('toClientId');
  return pick('clientId');
}

export function eventsOf(row: Pick<WebhookRow, 'events'>): string[] {
  return Array.isArray(row.events)
    ? (row.events as unknown[]).filter((e): e is string => typeof e === 'string')
    : [];
}
export function wants(row: Pick<WebhookRow, 'events'>, event: string): boolean {
  const list = eventsOf(row);
  return list.includes('*') || list.includes(event);
}

export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return `sha256=${Buffer.from(mac).toString('hex')}`;
}

/** Queue one delivery per matching webhook of the event's tenant. Returns how many were queued. */
export async function enqueueEvent(
  event: CoreEventName,
  payload: unknown,
  meta: { requestId?: string | null } = {},
): Promise<number> {
  const clientId = clientIdOf(event, payload);
  if (!clientId) return 0;
  const db = unsafeAcrossTenants(); // tenant condition explicit below
  const hooks = await db
    .select()
    .from(schema.webhooks)
    .where(
      and(
        eq(schema.webhooks.client_id, clientId),
        eq(schema.webhooks.enabled, true),
        isNull(schema.webhooks.deleted_at),
      ),
    );
  const targets = hooks.filter((h) => wants(h, event));
  const now = new Date();
  for (const h of targets) {
    await db.insert(schema.webhookDeliveries).values({
      id: newId(),
      client_id: clientId,
      webhook_id: h.id,
      event,
      payload: {
        event,
        occurredAt: now.toISOString(),
        clientId,
        requestId: meta.requestId ?? null,
        data: payload ?? null,
      },
      status: 'pending',
      attempts: 0,
      next_attempt_at: now,
    });
  }
  return targets.length;
}

export interface DeliverResult {
  readonly picked: number;
  readonly delivered: number;
  readonly retried: number;
  readonly failed: number;
}

/** One POST for one delivery row; updates the row and the webhook's last status. */
export async function attemptDelivery(
  d: DeliveryRow,
  hook: Pick<WebhookRow, 'id' | 'url' | 'secret'>,
  now = new Date(),
): Promise<'delivered' | 'retried' | 'failed'> {
  const db = unsafeAcrossTenants();
  const body = JSON.stringify({ id: d.id, ...(d.payload as Record<string, unknown>) });
  const timestamp = String(Math.floor(now.getTime() / 1000));
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        'x-crk-event': d.event,
        'x-crk-delivery': d.id,
        'x-crk-timestamp': timestamp,
        'x-crk-signature': await sign(hook.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'manual',
    });
    status = res.status;
    if (!(res.status >= 200 && res.status < 300)) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      error = `HTTP ${res.status}${text ? ` ${text}` : ''}`;
    }
  } catch (err) {
    error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  }
  const attempts = d.attempts + 1;
  if (error === null) {
    await db
      .update(schema.webhookDeliveries)
      .set({
        status: 'delivered',
        attempts,
        response_status: status,
        last_error: null,
        next_attempt_at: null,
        delivered_at: now,
      })
      .where(eq(schema.webhookDeliveries.id, d.id));
    await db
      .update(schema.webhooks)
      .set({ last_status: 'ok', last_error: null, last_delivered_at: now })
      .where(eq(schema.webhooks.id, hook.id));
    sentTotal.inc({ status: 'delivered' });
    return 'delivered';
  }
  const delay = RETRY_SCHEDULE_S[attempts - 1];
  const giveUp = delay === undefined;
  await db
    .update(schema.webhookDeliveries)
    .set({
      status: giveUp ? 'failed' : 'pending',
      attempts,
      response_status: status,
      last_error: error,
      next_attempt_at: giveUp ? null : new Date(now.getTime() + delay * 1000),
    })
    .where(eq(schema.webhookDeliveries.id, d.id));
  await db
    .update(schema.webhooks)
    .set({ last_status: 'error', last_error: error })
    .where(eq(schema.webhooks.id, hook.id));
  sentTotal.inc({ status: giveUp ? 'failed' : 'retried' });
  return giveUp ? 'failed' : 'retried';
}

/** Deliver due rows (all tenants), oldest first. Job body and post-enqueue nudge. */
export async function deliverWebhooksOnce(limit = 50, now = new Date()): Promise<DeliverResult> {
  const db = unsafeAcrossTenants();
  const due = await db
    .select({ d: schema.webhookDeliveries, h: schema.webhooks })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhooks, eq(schema.webhooks.id, schema.webhookDeliveries.webhook_id))
    .where(
      and(
        eq(schema.webhookDeliveries.status, 'pending'),
        or(
          isNull(schema.webhookDeliveries.next_attempt_at),
          lte(schema.webhookDeliveries.next_attempt_at, now),
        ),
        eq(schema.webhooks.enabled, true),
        isNull(schema.webhooks.deleted_at),
      ),
    )
    .orderBy(asc(schema.webhookDeliveries.created_at))
    .limit(limit);
  const r = { picked: due.length, delivered: 0, retried: 0, failed: 0 };
  for (const { d, h } of due) {
    const outcome = await attemptDelivery(d, h, now);
    r[outcome]++;
  }
  return r;
}

/** Fire-and-forget nudge after an enqueue so the common case is delivered within a second. */
export function nudgeDelivery(): void {
  deliverWebhooksOnce(20).catch((err) =>
    logger.warn('webhooks: nudge failed', {
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/** A synchronous test ping for the admin UI: not queued, not counted as a real event. */
export async function sendTestPing(hook: WebhookRow): Promise<{
  ok: boolean;
  status: number | null;
  error: string | null;
  ms: number;
}> {
  const started = performance.now();
  const now = new Date();
  const body = JSON.stringify({
    id: newId(),
    event: 'webhook.test',
    occurredAt: now.toISOString(),
    clientId: hook.client_id,
    requestId: null,
    data: { webhookId: hook.id, name: hook.name },
  });
  const timestamp = String(Math.floor(now.getTime() / 1000));
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        'x-crk-event': 'webhook.test',
        'x-crk-timestamp': timestamp,
        'x-crk-signature': await sign(hook.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'manual',
    });
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      status: res.status,
      error: ok ? null : `HTTP ${res.status}`,
      ms: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      ms: Math.round(performance.now() - started),
    };
  }
}
