import mqtt from 'mqtt';
import { type MqttResolved, MqttService, testMqtt } from '../../apps/api/src/mqtt.ts';

/**
 * MQTT smoke against a REAL MQTT 5 broker (`docker compose --profile mqtt up -d`, or the
 * mosquitto service in CI): what the in-process aedes broker of apps/api/test/mqtt.test.ts cannot
 * prove — shared subscriptions. Two services play two API instances of one deployment
 * (`--scale api=2`); a gateway publishes N messages; the handlers must have seen each message
 * EXACTLY once between them. Then the Settings "test connection" round trip, as preflight runs it.
 *
 *   MQTT_URL=mqtt://127.0.0.1:31883 bun run ci:mqtt-smoke
 */
const url = process.env.MQTT_URL ?? 'mqtt://127.0.0.1:31883';
const N = 60;

const resolved = (instance: string): MqttResolved => ({
  enabled: true,
  config: {
    url,
    username: process.env.MQTT_USERNAME || null,
    password: process.env.MQTT_PASSWORD || null,
    protocolVersion: 5,
    clientIdPrefix: `smoke${process.pid % 1000}`,
    topicPrefix: `smoke/${process.pid}`,
    source: 'env',
  },
  problem: null,
  ...(instance ? {} : {}),
});

const seen = new Map<string, number>();
const perInstance = new Map<string, number>();
const subscriptions = [
  {
    name: 'smoke.readings',
    topic: 'site/+/readings',
    qos: 1 as const,
    handler: (m: { text(): string }, ctx: { instanceId: string }) => {
      const id = m.text();
      seen.set(id, (seen.get(id) ?? 0) + 1);
      perInstance.set(ctx.instanceId, (perInstance.get(ctx.instanceId) ?? 0) + 1);
    },
  },
];
const fail = (msg: string): never => {
  console.error(`mqtt-smoke: FAIL — ${msg}`);
  process.exit(1);
};

const a = new MqttService({
  modules: [{ module: 'Smoke', subscriptions }],
  load: async () => resolved('a'),
  refreshMs: 0,
  instanceId: 'api-a',
});
const b = new MqttService({
  modules: [{ module: 'Smoke', subscriptions }],
  load: async () => resolved('b'),
  refreshMs: 0,
  instanceId: 'api-b',
});
await Promise.all([a.start(), b.start()]);
const deadline = Date.now() + 10_000;
while (!(a.state().connected && b.state().connected)) {
  if (Date.now() > deadline)
    fail(`not connected: ${a.state().lastError ?? b.state().lastError ?? url}`);
  await Bun.sleep(50);
}
await Bun.sleep(300); // SUBACKs

const cfg = resolved('gw').config;
if (!cfg) fail('config');
const gateway = await mqtt.connectAsync(url, {
  protocolVersion: 5,
  clientId: `gateway-${process.pid}`,
  ...(cfg?.username ? { username: cfg.username } : {}),
  ...(cfg?.password ? { password: cfg.password } : {}),
});
for (let i = 0; i < N; i++) {
  await gateway.publishAsync(`${cfg?.topicPrefix}/site/g${i % 3}/readings`, `m${i}`, { qos: 1 });
}
const until = Date.now() + 10_000;
while ([...seen.values()].reduce((s, n) => s + n, 0) < N && Date.now() < until) await Bun.sleep(50);
await Bun.sleep(300); // anything duplicated would arrive now
await gateway.endAsync();

const total = [...seen.values()].reduce((s, n) => s + n, 0);
const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
const missing = Array.from({ length: N }, (_, i) => `m${i}`).filter((id) => !seen.has(id));
console.log(
  JSON.stringify({
    url,
    sent: N,
    handled: total,
    perInstance: Object.fromEntries(perInstance),
    dupes: dupes.length,
    missing: missing.length,
  }),
);
if (missing.length) fail(`${missing.length} messages never reached a handler`);
if (dupes.length)
  fail(`${dupes.length} messages handled on BOTH instances — shared subscription not honoured`);
if (perInstance.size < 2)
  console.warn(
    'mqtt-smoke: warning — the broker gave every message to one instance (allowed, but check the share group)',
  );

// A publish from one instance reaches the other through the deployment prefix.
const echo = new Promise<string>((resolve) => {
  const sub = {
    name: 'smoke.echo',
    topic: 'echo',
    shared: false,
    handler: (m: { text(): string }) => resolve(m.text()),
  };
  const c = new MqttService({
    modules: [{ module: 'Smoke', subscriptions: [sub] }],
    load: async () => resolved('c'),
    refreshMs: 0,
    instanceId: 'api-c',
  });
  void c.start().then(async () => {
    while (!c.state().connected) await Bun.sleep(50);
    await Bun.sleep(300);
    const r = await a.publish('echo', 'hello');
    if (!r.ok) fail(`publish refused: ${JSON.stringify(r)}`);
    setTimeout(() => void c.stop(), 1_000);
  });
});
const got = await Promise.race([echo, Bun.sleep(5_000).then(() => 'TIMEOUT')]);
if (got !== 'hello') fail(`echo through publish(): ${got}`);

await Promise.all([a.stop(), b.stop()]);

const probe = await testMqtt(cfg ?? fail('config'), { timeoutMs: 5_000 });
console.log(JSON.stringify({ test: probe.ok, message: probe.message }));
if (!probe.ok) fail(probe.message);
console.log('mqtt-smoke: OK');
process.exit(0);
