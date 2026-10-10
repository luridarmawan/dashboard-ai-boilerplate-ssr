import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:net';
import type { MqttMessage, MqttSubscriptionDef } from '@core/module-kit';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import {
  type MqttResolved,
  MqttService,
  normalizeTopicPrefix,
  resolveMqtt,
  testMqtt,
} from '../src/mqtt.ts';

/**
 * The core MQTT client (extension point 18) against an in-process broker (aedes, MQTT 3.1.1):
 * the switch, the prefix, dispatch to module handlers, publish, the test round trip. Shared
 * subscriptions are MQTT 5 and need a real broker — that is the `--profile mqtt` smoke in CI.
 */
let broker: Aedes;
let server: Server;
let url = '';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met in time');
    await wait(20);
  }
}

beforeAll(async () => {
  broker = await Aedes.createBroker();
  server = createServer(broker.handle);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `mqtt://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => broker.close(() => r()));
  server.close();
});

const config = (over: Partial<MqttResolved> & { prefix?: string } = {}): MqttResolved => ({
  enabled: true,
  config: {
    url,
    username: null,
    password: null,
    protocolVersion: 4,
    clientIdPrefix: 'crk',
    topicPrefix: over.prefix ?? '',
    source: 'settings',
  },
  problem: null,
  ...over,
});

describe('resolveMqtt — settings first, then .env, field by field (E-6)', () => {
  test('no URL anywhere = nothing configured; a bad URL is a problem, not a connection attempt', () => {
    expect(resolveMqtt({ setting: empty(), env: {} })).toEqual({ config: null, problem: null });
    const bad = resolveMqtt({ setting: { ...empty(), url: 'broker:1883' }, env: {} });
    expect(bad.config).toBeNull();
    expect(bad.problem).toMatch(/tidak valid/);
  });

  test('a filled setting wins over .env per field; the source names where the URL came from', () => {
    const r = resolveMqtt({
      setting: {
        ...empty(),
        username: 'db-user',
        protocolVersion: '4',
        topicPrefix: '/acme/prod/',
      },
      env: { MQTT_URL: 'mqtts://env:8883', MQTT_USERNAME: 'env-user', MQTT_PASSWORD: 'pw' },
    });
    expect(r.config).toEqual({
      url: 'mqtts://env:8883',
      username: 'db-user',
      password: 'pw',
      protocolVersion: 4,
      clientIdPrefix: 'crk',
      topicPrefix: 'acme/prod',
      source: 'env',
    });
    expect(normalizeTopicPrefix(' / a / /b/ ')).toBe('a/b');
  });

  function empty() {
    return {
      url: null,
      username: null,
      password: null,
      protocolVersion: null,
      clientIdPrefix: null,
      topicPrefix: null,
    };
  }
});

describe('MqttService — switch, dispatch, publish', () => {
  test('off = no connection and publish() answers `disabled`', async () => {
    const svc = new MqttService({
      modules: [],
      load: async () => config({ enabled: false }),
      refreshMs: 0,
      instanceId: 'test-off',
    });
    await svc.start();
    expect(svc.state()).toMatchObject({ enabled: false, connected: false, configured: true });
    expect(await svc.publish('x', 'y')).toEqual({ ok: false, reason: 'disabled' });
    await svc.stop();
  });

  test('on = connected; module handlers get the message with params; prefix added and stripped', async () => {
    const seen: { topic: string; params: readonly string[]; body: unknown; sub: string }[] = [];
    const subs: MqttSubscriptionDef[] = [
      {
        name: 'alpha.readings',
        topic: 'site/+/readings',
        handler: (m: MqttMessage, ctx) => {
          seen.push({ topic: m.topic, params: m.params, body: m.json(), sub: ctx.subscription });
        },
      },
      {
        name: 'alpha.boom',
        topic: 'site/+/readings',
        handler: () => {
          throw new Error('handler exploded');
        },
      },
    ];
    const svc = new MqttService({
      modules: [{ module: 'Alpha', subscriptions: subs }],
      load: async () => config({ prefix: 'acme/dev' }),
      refreshMs: 0,
      instanceId: 'test-on',
    });
    await svc.start();
    await until(() => svc.state().connected);
    expect(svc.state().subscriptions.map((s) => s.name)).toEqual(['alpha.readings', 'alpha.boom']);

    // An outside publisher on the FULL topic (prefix included), as a gateway would.
    const outside = await mqtt.connectAsync(url, { protocolVersion: 4, clientId: 'gateway' });
    await wait(100); // the service subscribes right after `connect`; give the SUBACK a moment
    await outside.publishAsync('acme/dev/site/gudang-a/readings', JSON.stringify({ x: 1 }), {
      qos: 1,
    });
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual({
      topic: 'site/gudang-a/readings',
      params: ['gudang-a'],
      body: { x: 1 },
      sub: 'alpha.readings',
    });
    // A message outside the prefix never reaches a handler.
    await outside.publishAsync('site/gudang-a/readings', '{"x":2}', { qos: 1 });
    await wait(150);
    expect(seen.length).toBe(1);

    // publish() adds the prefix; the outside client sees the full topic.
    const got = new Promise<string>((r) => outside.on('message', (t) => r(t)));
    await outside.subscribeAsync('acme/dev/#');
    expect(await svc.publish('alerts/high', 'temp')).toEqual({ ok: true });
    expect(await got).toBe('acme/dev/alerts/high');
    expect(await svc.publish('bad/+/topic', 'x')).toMatchObject({
      ok: false,
      reason: 'invalid_topic',
    });

    await outside.endAsync();
    await svc.stop();
    expect(svc.state().connected).toBe(false);
  });

  test('reload() follows the switch without a restart and ignores an unchanged configuration', async () => {
    let current = config({ enabled: false });
    let loads = 0;
    const svc = new MqttService({
      modules: [],
      load: async () => {
        loads++;
        return current;
      },
      refreshMs: 0,
      instanceId: 'test-reload',
    });
    await svc.start();
    expect(svc.state().connected).toBe(false);
    current = config();
    await svc.reload();
    await until(() => svc.state().connected);
    const since = svc.state().connectedAt;
    await svc.reload(); // same configuration → the connection is kept
    expect(svc.state().connectedAt).toBe(since);
    current = config({ enabled: false });
    await svc.reload();
    expect(svc.state().connected).toBe(false);
    expect(loads).toBe(4);
    await svc.stop();
  });
});

describe('testMqtt — the Settings → MQTT round trip', () => {
  test('a reachable broker echoes the probe; a dead port fails with the step and a hint', async () => {
    const good = await testMqtt(config().config ?? never(), { timeoutMs: 3000 });
    expect(good.ok).toBe(true);
    expect(good.message).toMatch(/kembali dalam/);
    const dead = await testMqtt(
      { ...(config().config ?? never()), url: 'mqtt://127.0.0.1:1' },
      { timeoutMs: 1500 },
    );
    expect(dead.ok).toBe(false);
    expect(dead.message).toMatch(/gagal/);
    expect(dead.details.some((d) => /URL dan port/.test(d))).toBe(true);
  });
  function never(): never {
    throw new Error('config expected');
  }
});
