import { env } from '@core/config';
import { logger } from '@core/logger';
import {
  invalidTopicName,
  type MqttContext,
  type MqttMessage,
  type MqttPublishOptions,
  type MqttPublishResult,
  type MqttQos,
  type MqttSubscriptionDef,
  matchTopic,
} from '@core/module-kit';
import mqtt, { type IClientOptions, type IPublishPacket, type MqttClient } from 'mqtt';
import { instanceId } from './instance.ts';
import { metrics } from './metrics.ts';
import { settings } from './services.ts';

/**
 * The MQTT client of this API process (extension point 18, `docs/MQTT.md`).
 *
 *   mqttFor()     where the broker is and whether the client is on — Settings → MQTT first, then
 *                 `MQTT_*` from .env field by field (E-6), read from the GLOBAL scope only: one
 *                 broker per deployment, one connection per process
 *   MqttService   connects, subscribes every module's `mqtt.ts` (with the deployment's topic
 *                 prefix and, on MQTT 5, as a shared subscription so a message is handled by ONE
 *                 instance under --scale api=N), dispatches messages to the matching handlers,
 *                 and follows the switch WITHOUT a restart: the instance that saved the section
 *                 reloads at once (`config.saved`), every other instance within `refreshMs`
 *   publish()     what modules call (`@app/api/mqtt`); never throws — MQTT is usually optional
 *                 to the caller, so the outcome is a value
 *   testMqtt()    the Settings → MQTT "test connection" round trip
 *
 * Reconnects, keep-alives and backoff are mqtt.js's; a handler that throws is logged and counted
 * (G-7), never crashes the client.
 */

export interface MqttConfig {
  readonly url: string;
  readonly username: string | null;
  readonly password: string | null;
  readonly protocolVersion: 4 | 5;
  /** Client ids are `<prefix>-<instance>`; the prefix doubles as the shared-subscription group. */
  readonly clientIdPrefix: string;
  /** Normalised (no leading/trailing slash); empty = no prefix. */
  readonly topicPrefix: string;
  /** Where the URL came from — the answer to "which broker did I just test?". */
  readonly source: 'settings' | 'env';
}

/** What the database holds for `mqtt.*` (null = empty) and what .env offers as bootstrap. */
export interface MqttSources {
  readonly setting: {
    readonly url: string | null;
    readonly username: string | null;
    readonly password: string | null;
    readonly protocolVersion: string | null;
    readonly clientIdPrefix: string | null;
    readonly topicPrefix: string | null;
  };
  readonly env: {
    readonly MQTT_URL?: string | undefined;
    readonly MQTT_USERNAME?: string | undefined;
    readonly MQTT_PASSWORD?: string | undefined;
    readonly MQTT_CLIENT_ID_PREFIX?: string | undefined;
    readonly MQTT_TOPIC_PREFIX?: string | undefined;
  };
}

const URL_RE = /^(mqtts?|wss?):\/\/\S+$/;
const PREFIX_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** `/acme/prod/` → `acme/prod`; whitespace and empty levels are not a prefix. */
export function normalizeTopicPrefix(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
}

/**
 * Per field: database setting when filled, else .env. The URL is the minimum; without it there is
 * no broker. A URL that is not mqtt(s):// or ws(s):// is reported as a problem rather than tried.
 */
export function resolveMqtt(
  src: MqttSources,
): { config: MqttConfig; problem: null } | { config: null; problem: string | null } {
  const { setting, env: e } = src;
  const fromSetting = !!setting.url?.trim();
  const url = setting.url?.trim() || e.MQTT_URL?.trim() || '';
  if (!url) return { config: null, problem: null };
  if (!URL_RE.test(url))
    return {
      config: null,
      problem: `URL broker tidak valid: "${url}" (mqtt://, mqtts://, ws://, wss://)`,
    };
  const prefixRaw = setting.clientIdPrefix?.trim() || e.MQTT_CLIENT_ID_PREFIX?.trim() || 'crk';
  if (!PREFIX_RE.test(prefixRaw))
    return { config: null, problem: `awalan client id tidak valid: "${prefixRaw}"` };
  return {
    config: {
      url,
      username: setting.username?.trim() || e.MQTT_USERNAME?.trim() || null,
      password: setting.password || e.MQTT_PASSWORD || null,
      protocolVersion: setting.protocolVersion === '4' ? 4 : 5,
      clientIdPrefix: prefixRaw,
      topicPrefix: normalizeTopicPrefix(setting.topicPrefix ?? e.MQTT_TOPIC_PREFIX),
      source: fromSetting ? 'settings' : 'env',
    },
    problem: null,
  };
}

export interface MqttResolved {
  readonly enabled: boolean;
  readonly config: MqttConfig | null;
  /** Why `config` is null although something was configured (bad URL); null otherwise. */
  readonly problem: string | null;
}

/** The switch and the broker as the GLOBAL scope resolves them right now. */
export async function mqttFor(): Promise<MqttResolved> {
  const e = env();
  const str = (key: string) => settings.get<string | null>(null, key);
  const enabled = (await settings.get<boolean | null>(null, 'mqtt.enabled')) === true;
  const r = resolveMqtt({
    setting: {
      url: await str('mqtt.url'),
      username: await str('mqtt.username'),
      password: await str('mqtt.password'),
      protocolVersion: await str('mqtt.protocol_version'),
      clientIdPrefix: await str('mqtt.client_id_prefix'),
      topicPrefix: await str('mqtt.topic_prefix'),
    },
    env: e,
  });
  return { enabled, config: r.config, problem: r.problem };
}

/** Is the core-event bridge on (Settings → MQTT → publish core events)? */
export async function publishEventsEnabled(): Promise<boolean> {
  return (await settings.get<boolean | null>(null, 'mqtt.publish_events')) === true;
}

// ---- metrics (M-6) ----
const messagesTotal = metrics.counter(
  'mqtt_messages_total',
  'MQTT messages on this instance, by direction and outcome.',
  ['direction', 'status'],
);
const handlerRunsTotal = metrics.counter(
  'mqtt_handler_runs_total',
  'Module MQTT handler invocations, by subscription and outcome.',
  ['subscription', 'status'],
);
const handlerDuration = metrics.histogram(
  'mqtt_handler_duration_seconds',
  'Module MQTT handler duration in seconds.',
  ['subscription'],
  [0.005, 0.025, 0.1, 0.5, 2, 10],
);
metrics
  .gauge('mqtt_connected', 'Whether this instance is connected to the MQTT broker (1/0).')
  .collect((g) => g.set(service?.state().connected ? 1 : 0));

export interface ModuleMqtt {
  readonly module: string;
  readonly subscriptions: readonly MqttSubscriptionDef[];
}

export interface MqttSubscriptionState {
  readonly name: string;
  readonly module: string;
  readonly topic: string;
  readonly qos: MqttQos;
  readonly shared: boolean;
}

export interface MqttState {
  readonly enabled: boolean;
  /** A broker URL is known (settings or .env). */
  readonly configured: boolean;
  readonly connected: boolean;
  readonly url: string | null;
  readonly source: 'settings' | 'env' | null;
  readonly protocolVersion: 4 | 5 | null;
  readonly topicPrefix: string;
  readonly subscriptions: readonly MqttSubscriptionState[];
  readonly lastError: string | null;
  readonly connectedAt: string | null;
}

/** Seam for tests: how the service obtains a client. */
export type MqttConnect = (url: string, opts: IClientOptions) => MqttClient;

export interface MqttServiceOptions {
  readonly modules: readonly ModuleMqtt[];
  /** How the switch and broker are read; `mqttFor` in production. */
  readonly load?: () => Promise<MqttResolved>;
  readonly connect?: MqttConnect;
  /** How often every instance re-reads the section to pick up a change saved elsewhere. */
  readonly refreshMs?: number;
  readonly instanceId?: string;
}

const OFF: MqttState = {
  enabled: false,
  configured: false,
  connected: false,
  url: null,
  source: null,
  protocolVersion: null,
  topicPrefix: '',
  subscriptions: [],
  lastError: null,
  connectedAt: null,
};

/** Username/password only when set — mqtt.js types refuse an explicit `undefined`. */
function credentials(config: MqttConfig): Pick<IClientOptions, 'username' | 'password'> {
  return {
    ...(config.username ? { username: config.username } : {}),
    ...(config.password ? { password: config.password } : {}),
  };
}

function clientIdFor(prefix: string, instance: string): string {
  // MQTT 3.1.1 brokers may cap client ids at 23 bytes; keep the instance part short and safe.
  const safe = instance.replace(/[^A-Za-z0-9_-]/g, '-').slice(-32);
  return `${prefix}-${safe}`;
}

function message(
  topic: string,
  payload: Buffer,
  packet: IPublishPacket,
  params: readonly string[],
): MqttMessage {
  return {
    topic,
    payload: new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
    qos: (packet.qos ?? 0) as MqttQos,
    retain: !!packet.retain,
    params,
    text: () => payload.toString('utf8'),
    json: <T>() => {
      try {
        return JSON.parse(payload.toString('utf8')) as T;
      } catch {
        return null;
      }
    },
  };
}

export class MqttService {
  private client: MqttClient | null = null;
  private active: { enabled: boolean; config: MqttConfig | null; problem: string | null } | null =
    null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reloading: Promise<void> | null = null;
  private again = false;
  private sharedWarned = false;
  private readonly abort = new AbortController();
  private readonly subs: readonly { module: string; def: MqttSubscriptionDef }[];
  private readonly load: () => Promise<MqttResolved>;
  private readonly connect: MqttConnect;
  private readonly refreshMs: number;
  private readonly instance: string;

  constructor(opts: MqttServiceOptions) {
    this.subs = opts.modules.flatMap((m) =>
      m.subscriptions.map((def) => ({ module: m.module, def })),
    );
    this.load = opts.load ?? mqttFor;
    this.connect = opts.connect ?? ((url, o) => mqtt.connect(url, o));
    this.refreshMs = opts.refreshMs ?? 30_000;
    this.instance = opts.instanceId ?? instanceId;
  }

  /** Read the switch and connect when on; then watch for changes saved on other instances. */
  async start(): Promise<void> {
    await this.reload();
    if (this.refreshMs > 0) {
      this.timer = setInterval(() => void this.reload(), this.refreshMs);
      // A watcher must not keep a finished process (tests, one-off scripts) alive.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  /** Re-read the switch and broker; reconnect only when something changed. Calls coalesce. */
  reload(): Promise<void> {
    if (this.reloading) {
      this.again = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      try {
        do {
          this.again = false;
          await this.apply(await this.load());
        } while (this.again);
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        logger.warn('mqtt: configuration could not be read', { error: this.lastError });
      } finally {
        this.reloading = null;
      }
    })();
    return this.reloading;
  }

  private async apply(next: MqttResolved): Promise<void> {
    const prev = this.active;
    const same =
      prev &&
      prev.enabled === next.enabled &&
      prev.problem === next.problem &&
      JSON.stringify(prev.config) === JSON.stringify(next.config);
    if (same) return;
    this.active = { enabled: next.enabled, config: next.config, problem: next.problem };
    await this.disconnect();
    if (!next.enabled) {
      if (prev?.enabled) logger.info('mqtt: switched off');
      return;
    }
    if (!next.config) {
      this.lastError = next.problem ?? 'broker belum dikonfigurasi (mqtt.url / MQTT_URL)';
      logger.warn('mqtt: enabled but unusable', { error: this.lastError });
      return;
    }
    this.open(next.config);
  }

  private open(config: MqttConfig): void {
    const client = this.connect(config.url, {
      clientId: clientIdFor(config.clientIdPrefix, this.instance),
      ...credentials(config),
      protocolVersion: config.protocolVersion,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 5_000,
      connectTimeout: 10_000,
    });
    this.client = client;
    client.on('connect', () => {
      this.connected = true;
      this.connectedAt = new Date();
      this.lastError = null;
      logger.info('mqtt: connected', {
        url: config.url,
        source: config.source,
        protocolVersion: config.protocolVersion,
        subscriptions: this.subs.length,
      });
      void this.subscribeAll(client, config);
    });
    client.on('message', (topic, payload, packet) => this.dispatch(config, topic, payload, packet));
    client.on('error', (err) => {
      this.lastError = err.message;
      const hint = /protocol version/i.test(err.message)
        ? ' — broker menolak versi protokol; coba MQTT 3.1.1 di Pengaturan → MQTT'
        : '';
      logger.warn(`mqtt: ${err.message}${hint}`, { url: config.url });
    });
    client.on('close', () => {
      if (this.connected) logger.warn('mqtt: connection closed', { url: config.url });
      this.connected = false;
    });
  }

  private async subscribeAll(client: MqttClient, config: MqttConfig): Promise<void> {
    for (const { module, def } of this.subs) {
      const shared = def.shared !== false;
      if (shared && config.protocolVersion !== 5 && !this.sharedWarned) {
        this.sharedWarned = true;
        logger.warn(
          'mqtt: shared subscriptions need MQTT 5 — on this broker every instance receives every message',
        );
      }
      const filter = this.filterFor(def, config);
      try {
        const granted = await client.subscribeAsync(filter, { qos: def.qos ?? 1 });
        const refused = granted.find((g) => g.qos > 2);
        if (refused) {
          messagesTotal.inc({ direction: 'in', status: 'refused' });
          logger.warn('mqtt: subscription refused by the broker', {
            subscription: def.name,
            module,
            filter,
            reason: refused.qos,
          });
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        logger.warn('mqtt: subscribe failed', {
          subscription: def.name,
          module,
          filter,
          error: this.lastError,
        });
      }
    }
  }

  /** The filter as the broker sees it: `$share/<group>/` (MQTT 5) + prefix + the module's filter. */
  private filterFor(def: MqttSubscriptionDef, config: MqttConfig): string {
    const prefixed = config.topicPrefix ? `${config.topicPrefix}/${def.topic}` : def.topic;
    return def.shared !== false && config.protocolVersion === 5
      ? `$share/${config.clientIdPrefix}/${prefixed}`
      : prefixed;
  }

  private dispatch(
    config: MqttConfig,
    fullTopic: string,
    payload: Buffer,
    packet: IPublishPacket,
  ): void {
    let topic = fullTopic;
    if (config.topicPrefix) {
      if (!fullTopic.startsWith(`${config.topicPrefix}/`)) {
        messagesTotal.inc({ direction: 'in', status: 'dropped' });
        return;
      }
      topic = fullTopic.slice(config.topicPrefix.length + 1);
    }
    let matched = 0;
    for (const { module, def } of this.subs) {
      const params = matchTopic(def.topic, topic);
      if (!params) continue;
      matched++;
      void this.run(module, def, message(topic, payload, packet, params));
    }
    messagesTotal.inc({ direction: 'in', status: matched ? 'handled' : 'unmatched' });
  }

  private async run(module: string, def: MqttSubscriptionDef, msg: MqttMessage): Promise<void> {
    const ctx: MqttContext = {
      subscription: def.name,
      module,
      instanceId: this.instance,
      receivedAt: new Date(),
      signal: this.abort.signal,
      publish: (topic, payload, opts) => this.publish(topic, payload, opts),
    };
    const t0 = performance.now();
    try {
      await def.handler(msg, ctx);
      handlerRunsTotal.inc({ subscription: def.name, status: 'ok' });
    } catch (err) {
      handlerRunsTotal.inc({ subscription: def.name, status: 'failed' });
      logger.error('mqtt: handler failed', {
        subscription: def.name,
        module,
        topic: msg.topic,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      handlerDuration.observeMs({ subscription: def.name }, performance.now() - t0);
    }
  }

  /** Publish under the deployment prefix. Never throws; the outcome is the value. */
  async publish(
    topic: string,
    payload: string | Uint8Array,
    opts: MqttPublishOptions = {},
  ): Promise<MqttPublishResult> {
    const cfg = this.active?.config ?? null;
    if (!this.active?.enabled || !cfg || !this.client) {
      messagesTotal.inc({ direction: 'out', status: 'refused' });
      return { ok: false, reason: 'disabled' };
    }
    const why = invalidTopicName(topic);
    if (why) {
      messagesTotal.inc({ direction: 'out', status: 'refused' });
      return { ok: false, reason: 'invalid_topic', error: why };
    }
    if (!this.connected) {
      messagesTotal.inc({ direction: 'out', status: 'refused' });
      return {
        ok: false,
        reason: 'disconnected',
        ...(this.lastError ? { error: this.lastError } : {}),
      };
    }
    const full = cfg.topicPrefix ? `${cfg.topicPrefix}/${topic}` : topic;
    try {
      await this.client.publishAsync(
        full,
        typeof payload === 'string' ? payload : Buffer.from(payload),
        { qos: opts.qos ?? 1, retain: opts.retain ?? false },
      );
      messagesTotal.inc({ direction: 'out', status: 'ok' });
      return { ok: true };
    } catch (err) {
      messagesTotal.inc({ direction: 'out', status: 'failed' });
      return {
        ok: false,
        reason: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  state(): MqttState {
    const a = this.active;
    const cfg = a?.config ?? null;
    return {
      enabled: a?.enabled ?? false,
      configured: !!cfg,
      connected: this.connected,
      url: cfg?.url ?? null,
      source: cfg?.source ?? null,
      protocolVersion: cfg?.protocolVersion ?? null,
      topicPrefix: cfg?.topicPrefix ?? '',
      subscriptions: this.subs.map(({ module, def }) => ({
        name: def.name,
        module,
        topic: def.topic,
        qos: def.qos ?? 1,
        shared: def.shared !== false,
      })),
      lastError: this.lastError,
      connectedAt: this.connectedAt?.toISOString() ?? null,
    };
  }

  private async disconnect(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.connected = false;
    this.connectedAt = null;
    if (!c) return;
    try {
      await c.endAsync();
    } catch {
      c.end(true);
    }
  }

  /** Stop watching, abort running handlers and close the connection (process shutdown). */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort.abort();
    await this.disconnect();
  }
}

// ---- the process service (set by the runtime; null under app.handle() in tests) ----
let service: MqttService | null = null;
export function setMqttService(s: MqttService | null): void {
  service = s;
}

/** What modules call. `{ ok: false, reason: 'disabled' }` when the client is off or not serving. */
export function publish(
  topic: string,
  payload: string | Uint8Array,
  opts?: MqttPublishOptions,
): Promise<MqttPublishResult> {
  return service
    ? service.publish(topic, payload, opts)
    : Promise.resolve({ ok: false, reason: 'disabled' });
}

/** The client's state on THIS instance — for `/ready`, the Settings page and module UIs. */
export function mqttState(): MqttState {
  return service?.state() ?? OFF;
}

export interface MqttTestResult {
  readonly ok: boolean;
  readonly message: string;
  readonly details: readonly string[];
}

/**
 * One round trip through a broker: connect, subscribe to a private probe topic, publish to it,
 * wait for the echo. Proves the URL, the credentials, the protocol version and that the account
 * may publish AND subscribe under the prefix — the four things that go wrong in practice.
 */
export async function testMqtt(
  config: MqttConfig,
  opts: { connect?: MqttConnect; timeoutMs?: number; instanceId?: string } = {},
): Promise<MqttTestResult> {
  const connect = opts.connect ?? ((url, o) => mqtt.connect(url, o));
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const probe = `_probe/${crypto.randomUUID()}`;
  const topic = config.topicPrefix ? `${config.topicPrefix}/${probe}` : probe;
  const context = [
    `${config.url} · MQTT ${config.protocolVersion === 5 ? '5' : '3.1.1'} · dari ${config.source === 'env' ? '.env' : 'Pengaturan'}`,
    config.username ? `autentikasi: user "${config.username}"` : 'tanpa autentikasi',
    config.topicPrefix ? `awalan topik "${config.topicPrefix}"` : 'tanpa awalan topik',
  ];
  const started = Date.now();
  let step = 'Koneksi/autentikasi';
  let client: MqttClient | null = null;
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`tidak ada jawaban dalam ${timeoutMs} ms`)),
        timeoutMs,
      );
      const done = (fn: () => void) => {
        clearTimeout(timer);
        fn();
      };
      client = connect(config.url, {
        clientId: clientIdFor(
          config.clientIdPrefix,
          `test-${(opts.instanceId ?? instanceId).slice(-8)}-${Date.now() % 100000}`,
        ),
        ...credentials(config),
        protocolVersion: config.protocolVersion,
        clean: true,
        reconnectPeriod: 0,
        connectTimeout: timeoutMs,
      });
      client.on('error', (err) => done(() => reject(err)));
      client.on('message', (t, p) => {
        if (t === topic) done(() => resolve(p.toString('utf8')));
      });
      client.on('connect', async () => {
        try {
          step = 'Langganan';
          const granted = await client?.subscribeAsync(topic, { qos: 1 });
          if (granted?.some((g) => g.qos > 2))
            throw new Error(`broker menolak langganan ke "${topic}" (ACL?)`);
          step = 'Publish & echo';
          await client?.publishAsync(topic, 'ping', { qos: 1 });
        } catch (err) {
          done(() => reject(err));
        }
      });
    });
    const ms = Date.now() - started;
    return {
      ok: result === 'ping',
      message: `Broker menjawab — pesan uji kembali dalam ${ms} ms`,
      details: [...context, `topik uji ${topic}`],
    };
  } catch (err) {
    const ms = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    const hint = /protocol version/i.test(message)
      ? 'Broker menolak versi protokol — pilih MQTT 3.1.1 di bagian ini.'
      : /not authorized|bad user name|authentication/i.test(message)
        ? 'Periksa username/password, atau ACL akun ini di broker.'
        : /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout|tidak ada jawaban/i.test(message)
          ? 'Periksa URL dan port, apakah service broker hidup (`dc --profile mqtt ps`), dan firewall.'
          : null;
    return {
      ok: false,
      message: `${step} gagal setelah ${ms} ms: ${message}`,
      details: [...context, ...(hint ? [hint] : [])],
    };
  } finally {
    const c = client as MqttClient | null;
    if (c) {
      try {
        await c.endAsync(true);
      } catch {
        /* already closed */
      }
    }
  }
}
