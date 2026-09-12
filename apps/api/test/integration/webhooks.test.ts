import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { and, type Db, desc, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';
import {
  attemptDelivery,
  deliverWebhooksOnce,
  enqueueEvent,
  RETRY_SCHEDULE_S,
  sign,
} from '../../src/webhooks.ts';

/**
 * Integration (INTEGRATION=1): outgoing webhooks (PRD J-5). A tenant registers a receiver; a core
 * event for that tenant becomes a signed POST the receiver can verify; a failing receiver gets
 * retries on the schedule and finally `failed`; another tenant's webhooks never see the event;
 * the secret is returned once and never echoed; the test ping and manual retry work.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.89.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `wh-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; details?: Record<string, unknown> };
}
const call = (
  path: string,
  init: RequestInit = {},
  cookies: string[] = [],
  extra: Record<string, string> = {},
) => {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';

type Received = { headers: Record<string, string>; body: string };

describe.skipIf(!enabled)(
  'outgoing webhooks (J-5): signed delivery, retries, tenancy, admin API',
  () => {
    let db: Db;
    let tenantId = '';
    let admin = '';
    let acmeId = '';
    let hookId = '';
    let secret = '';
    const received: Received[] = [];
    let mode: 'ok' | 'fail' = 'ok';
    let server: ReturnType<typeof Bun.serve>;

    beforeAll(async () => {
      if (!enabled) return;
      db = unsafeAcrossTenants();
      const s = await runSeed(db, { adminEmail, adminPassword });
      tenantId = s.tenantId;
      admin = sessionCookie(
        await call('/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: adminEmail, password: adminPassword }),
        }),
      );
      acmeId = newId();
      await db
        .insert(schema.clients)
        .values({ id: acmeId, code: `acme-wh-${run}`.slice(0, 32), name: 'Acme' });
      server = Bun.serve({
        port: 0,
        async fetch(req) {
          received.push({
            headers: Object.fromEntries(req.headers.entries()),
            body: await req.text(),
          });
          return mode === 'ok' ? new Response('ok') : new Response('nope', { status: 500 });
        },
      });
    });
    afterAll(() => server?.stop(true));

    test('register: 201 with the secret exactly once; list and detail never echo it; events are validated', async () => {
      const bad = await call(
        '/v1/webhooks',
        {
          method: 'POST',
          body: JSON.stringify({
            name: 'x',
            url: `http://127.0.0.1:${server.port}/h`,
            events: ['nope.event'],
          }),
        },
        [admin],
      );
      expect(bad.status).toBe(422);
      const r = await call(
        '/v1/webhooks',
        {
          method: 'POST',
          body: JSON.stringify({
            name: 'Receiver',
            url: `http://127.0.0.1:${server.port}/h`,
            events: ['user.created', 'config.saved'],
          }),
        },
        [admin],
      );
      expect(r.status).toBe(201);
      const created = (await json(r)).data as { id: string; secret: string; events: string[] };
      hookId = created.id;
      secret = created.secret;
      expect(secret.length).toBeGreaterThan(20);
      expect(created.events).toEqual(['user.created', 'config.saved']);
      const list = JSON.stringify(await json(await call('/v1/webhooks', {}, [admin])));
      expect(list).toContain(hookId);
      expect(list).not.toContain(secret);
      expect(
        JSON.stringify(await json(await call(`/v1/webhooks/${hookId}`, {}, [admin]))),
      ).not.toContain(secret);
      // Anonymous / another tenant: nothing.
      expect((await call('/v1/webhooks')).status).toBe(401);
      expect(
        (
          (await json(await call('/v1/webhooks', {}, [admin], { 'x-client-id': acmeId })))
            .data as unknown[]
        ).length,
      ).toBe(0);
    });

    test('a matching tenant event is enqueued and delivered as a signed POST the receiver can verify', async () => {
      received.length = 0;
      const n = await enqueueEvent(
        'user.created',
        { userId: newId(), clientId: tenantId },
        { requestId: 'r1' },
      );
      expect(n).toBe(1);
      // Events for another tenant or without a tenant never reach this webhook.
      expect(await enqueueEvent('user.created', { userId: newId(), clientId: acmeId })).toBe(0);
      expect(await enqueueEvent('user.created', { userId: newId(), clientId: null })).toBe(0);
      // Subscribed events only.
      expect(
        await enqueueEvent('module.toggled', { module: 'AI', clientId: tenantId, enabled: true }),
      ).toBe(0);

      const r = await deliverWebhooksOnce();
      expect(r.delivered).toBeGreaterThanOrEqual(1);
      const got = received.find((x) => x.headers['x-crk-event'] === 'user.created');
      expect(got).toBeDefined();
      const body = JSON.parse((got as Received).body) as {
        id: string;
        event: string;
        clientId: string;
        requestId: string;
        data: { clientId: string };
      };
      expect(body.event).toBe('user.created');
      expect(body.clientId).toBe(tenantId);
      expect(body.requestId).toBe('r1');
      expect(body.data.clientId).toBe(tenantId);
      expect((got as Received).headers['x-crk-delivery']).toBe(body.id);
      expect((got as Received).headers['user-agent']).toContain('dab-webhooks');
      // Receiver-side verification: HMAC of "<timestamp>.<body>" with the once-shown secret.
      const expected = await sign(
        secret,
        (got as Received).headers['x-crk-timestamp'] as string,
        (got as Received).body,
      );
      expect((got as Received).headers['x-crk-signature']).toBe(expected);
      // Delivery row + webhook status.
      const detail = (await json(await call(`/v1/webhooks/${hookId}`, {}, [admin]))).data as {
        lastStatus: string;
        deliveries: { id: string; status: string; attempts: number; responseStatus: number }[];
      };
      expect(detail.lastStatus).toBe('ok');
      const d = detail.deliveries.find((x) => x.id === body.id);
      expect(d).toMatchObject({ status: 'delivered', attempts: 1, responseStatus: 200 });
    });

    test('a failing receiver is retried on the schedule, then marked failed; a manual retry succeeds once it recovers', async () => {
      mode = 'fail';
      await enqueueEvent('config.saved', { section: 'app', key: 'app.name', clientId: tenantId });
      const first = await deliverWebhooksOnce();
      expect(first.retried).toBeGreaterThanOrEqual(1);
      // The seeded default tenant is shared with earlier runs: take THIS run's row (newest, ours).
      const [row] = await db
        .select()
        .from(schema.webhookDeliveries)
        .where(
          and(
            eq(schema.webhookDeliveries.client_id, tenantId),
            eq(schema.webhookDeliveries.webhook_id, hookId),
            eq(schema.webhookDeliveries.event, 'config.saved'),
          ),
        )
        .orderBy(desc(schema.webhookDeliveries.created_at))
        .limit(1);
      expect(row?.status).toBe('pending');
      expect(row?.attempts).toBe(1);
      expect(row?.last_error).toContain('HTTP 500');
      const nextAt = row?.next_attempt_at ?? new Date(0);
      const firstDelay = RETRY_SCHEDULE_S[0] ?? 60;
      expect(nextAt.getTime() - Date.now()).toBeGreaterThan(firstDelay * 1000 - 5000);
      // Not due yet: the job leaves it alone (other tenants' rows in a shared dev DB may be picked).
      await deliverWebhooksOnce();
      expect(
        (
          await db
            .select()
            .from(schema.webhookDeliveries)
            .where(eq(schema.webhookDeliveries.id, (row as { id: string }).id))
        )[0]?.attempts,
      ).toBe(1);
      // Exhaust the schedule directly.
      let cur = row as typeof schema.webhookDeliveries.$inferSelect;
      const hook = (
        await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, hookId))
      )[0]!;
      for (let i = 1; i < RETRY_SCHEDULE_S.length; i++) {
        expect(await attemptDelivery(cur, hook)).toBe('retried');
        cur = (
          await db
            .select()
            .from(schema.webhookDeliveries)
            .where(eq(schema.webhookDeliveries.id, cur.id))
        )[0]!;
      }
      expect(await attemptDelivery(cur, hook)).toBe('failed');
      cur = (
        await db
          .select()
          .from(schema.webhookDeliveries)
          .where(eq(schema.webhookDeliveries.id, cur.id))
      )[0]!;
      expect(cur.status).toBe('failed');
      expect(cur.attempts).toBe(RETRY_SCHEDULE_S.length + 1);
      // Receiver recovers; the admin retries by hand.
      mode = 'ok';
      const retry = await call(
        `/v1/webhooks/${hookId}/deliveries/${cur.id}/retry`,
        { method: 'POST' },
        [admin],
      );
      expect(retry.status).toBe(200);
      expect(((await json(retry)).data as { outcome: string }).outcome).toBe('delivered');
    });

    test('test ping, secret rotation, update, disable and delete', async () => {
      mode = 'ok';
      received.length = 0;
      const ping = (
        await json(await call(`/v1/webhooks/${hookId}/test`, { method: 'POST' }, [admin]))
      ).data as {
        ok: boolean;
        status: number;
      };
      expect(ping).toMatchObject({ ok: true, status: 200 });
      expect(received.at(-1)?.headers['x-crk-event']).toBe('webhook.test');
      const rotated = (
        await json(await call(`/v1/webhooks/${hookId}/rotate-secret`, { method: 'POST' }, [admin]))
      ).data as { secret: string };
      expect(rotated.secret).not.toBe(secret);
      // Disabled webhooks are not enqueued.
      const upd = await call(
        `/v1/webhooks/${hookId}`,
        { method: 'PUT', body: JSON.stringify({ enabled: false, events: ['*'] }) },
        [admin],
      );
      expect(upd.status).toBe(200);
      expect(((await json(upd)).data as { events: string[] }).events).toEqual(['*']);
      expect(await enqueueEvent('user.created', { userId: newId(), clientId: tenantId })).toBe(0);
      expect((await call(`/v1/webhooks/${hookId}`, { method: 'DELETE' }, [admin])).status).toBe(
        200,
      );
      expect((await call(`/v1/webhooks/${hookId}`, {}, [admin])).status).toBe(404);
    });
  },
);
