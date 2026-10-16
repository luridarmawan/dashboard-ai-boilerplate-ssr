import { ModuleContractError } from './contract.ts';
import { type LocalizedText, namespaceOf } from './manifest.ts';

/**
 * MQTT subscription contract (extension point 18; file `mqtt.ts`).
 *
 * The core owns ONE MQTT client per API process — its broker, credentials and on/off switch live
 * in Settings → MQTT (or `MQTT_*` in .env as bootstrap). A module only declares which topics it
 * wants and what to do with a message; it never connects, reconnects or imports an MQTT library.
 *
 * Guarantees the core gives every subscription:
 *   - it is subscribed on connect and on every reconnect, with the deployment's topic prefix
 *     (Settings → MQTT → topic prefix) added and stripped again before the handler sees the topic;
 *   - with `shared: true` (the default) the subscription is a shared subscription
 *     (`$share/<group>/<filter>`, MQTT 5) so that under `--scale api=3` the broker hands each
 *     message to ONE instance — the same "once per cluster" promise scheduled jobs have (G-18);
 *   - a handler that throws is logged and counted, never crashes the client and never blocks
 *     other subscriptions (the same rule as event hooks, G-7).
 *
 * Handlers run on the instance that received the message, in that process, without a request.
 * Keep them short: validate, write one row, `enqueue()` or `notify()` — anything heavier belongs
 * in the queue. Nothing in here depends on `@app/api`, so the contract stays importable from a
 * module in its own repository.
 */

export type MqttQos = 0 | 1 | 2;

/** One message delivered to a handler. `topic` is already relative to the deployment prefix. */
export interface MqttMessage {
  readonly topic: string;
  readonly payload: Uint8Array;
  readonly qos: MqttQos;
  readonly retain: boolean;
  /** What the subscription's wildcards matched, in filter order (`+` = one level, `#` = the rest). */
  readonly params: readonly string[];
  /** The payload as UTF-8 text. */
  text(): string;
  /** The payload parsed as JSON, or `null` when it is not valid JSON. */
  json<T = unknown>(): T | null;
}

export interface MqttPublishOptions {
  readonly qos?: MqttQos;
  readonly retain?: boolean;
}

/** The outcome of a publish — a plain value, because callers usually treat MQTT as optional. */
export type MqttPublishResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'disabled' | 'disconnected' | 'invalid_topic' | 'failed';
      readonly error?: string;
    };

export interface MqttContext {
  /** `<ns>.<name>` of the subscription that matched. */
  readonly subscription: string;
  readonly module: string;
  /** The API instance that received the message. */
  readonly instanceId: string;
  readonly receivedAt: Date;
  /** Aborted when the process shuts down; long handlers should stop early. */
  readonly signal: AbortSignal;
  /** Publish through the same client (prefix added by the core). Never throws. */
  publish(
    topic: string,
    payload: string | Uint8Array,
    opts?: MqttPublishOptions,
  ): Promise<MqttPublishResult>;
}

export interface MqttSubscriptionDef {
  /** `<ns>.<name>` — stable identity, shown in the module admin page and in metrics. */
  readonly name: string;
  /** Topic filter, MQTT wildcards allowed (`site/+/pos`, `events/#`). No `$share/` — the core adds it. */
  readonly topic: string;
  /** Requested QoS; default 1 (at least once). */
  readonly qos?: MqttQos;
  /**
   * Shared subscription (MQTT 5): the broker delivers each message to ONE instance of this
   * deployment. Default true. Set false only when EVERY instance must see every message (a cache
   * invalidation, for example). Ignored on MQTT 3.1.1 brokers, where every instance subscribes
   * plainly and the core logs a warning once.
   */
  readonly shared?: boolean;
  readonly description?: LocalizedText;
  readonly handler: (message: MqttMessage, ctx: MqttContext) => void | Promise<void>;
}

const NAME_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;

/**
 * Why a topic filter is invalid per the MQTT specification, or null when it is fine: non-empty,
 * no NUL, `+` only as a whole level, `#` only as the whole last level, and no `$share/` prefix
 * (shared subscriptions are the core's decision, see `shared`).
 */
export function invalidTopicFilter(filter: string): string | null {
  if (typeof filter !== 'string' || filter.length === 0) return 'kosong';
  if (filter.length > 1024) return 'lebih dari 1024 karakter';
  if (filter.includes('\0')) return 'memuat karakter NUL';
  if (filter.startsWith('$share/')) return 'jangan tulis $share/ — pakai `shared: true`';
  const levels = filter.split('/');
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i] ?? '';
    if (level === '#' && i !== levels.length - 1) return '"#" hanya boleh di level terakhir';
    if (level.length > 1 && (level.includes('#') || level.includes('+')))
      return `wildcard harus menempati satu level penuh ("${level}")`;
  }
  return null;
}

/** Why a topic to publish to is invalid, or null: like a filter, but wildcards are not allowed. */
export function invalidTopicName(topic: string): string | null {
  const why = invalidTopicFilter(topic);
  if (why) return why;
  if (topic.includes('#') || topic.includes('+'))
    return 'topik publish tidak boleh memuat wildcard';
  return null;
}

/**
 * Does `topic` match `filter`? Returns the wildcard captures in filter order, or null. Follows the
 * specification: `+` matches exactly one level (even an empty one), `#` matches the rest including
 * the parent level, and a topic starting with `$` never matches a filter starting with a wildcard.
 */
export function matchTopic(filter: string, topic: string): string[] | null {
  if ((filter.startsWith('+') || filter.startsWith('#')) && topic.startsWith('$')) return null;
  const f = filter.split('/');
  const t = topic.split('/');
  const params: string[] = [];
  for (let i = 0; i < f.length; i++) {
    const level = f[i];
    if (level === '#') {
      params.push(t.slice(i).join('/'));
      return params;
    }
    if (i >= t.length) return null;
    if (level === '+') params.push(t[i] ?? '');
    else if (level !== t[i]) return null;
  }
  return t.length === f.length ? params : null;
}

/** Declare a module's MQTT subscriptions (`mqtt.ts`). Names must carry the module namespace. */
export function defineMqtt(
  moduleName: string,
  subscriptions: readonly MqttSubscriptionDef[],
): readonly MqttSubscriptionDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const s of subscriptions) {
    if (!NAME_RE.test(s.name))
      throw new ModuleContractError(`nama langganan MQTT "${s.name}" tidak valid`);
    if (!s.name.startsWith(`${ns}.`)) {
      throw new ModuleContractError(`nama langganan MQTT "${s.name}" harus diawali "${ns}."`);
    }
    if (seen.has(s.name)) throw new ModuleContractError(`langganan MQTT "${s.name}" duplikat`);
    seen.add(s.name);
    const why = invalidTopicFilter(s.topic);
    if (why)
      throw new ModuleContractError(
        `langganan MQTT "${s.name}": filter topik tidak valid — ${why}`,
      );
    if (s.qos !== undefined && ![0, 1, 2].includes(s.qos))
      throw new ModuleContractError(`langganan MQTT "${s.name}": qos harus 0, 1, atau 2`);
    if (typeof s.handler !== 'function')
      throw new ModuleContractError(`langganan MQTT "${s.name}": handler bukan fungsi`);
  }
  return subscriptions;
}
