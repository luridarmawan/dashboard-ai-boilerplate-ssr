import { configureRateLimitRedis, configureSessionRedis, type RedisCommands } from '@core/auth';
import { env } from '@core/config';
import { unsafeAcrossTenants } from '@core/db';
import { modules } from '@core/module-kit/registry';
import type { EventBus } from '@core/runtime';
import {
  CustomThemeStore,
  ModuleStateStore,
  NoCache,
  RedisCache,
  type RedisLike,
  SettingsStore,
} from '@core/settings';

/**
 * Process-wide services shared by the domains. Configuration and module state are read on
 * every request, so they sit behind the cache adapter chosen by CACHE_DRIVER (E-5,
 * Decision M): `database` (versioned, default), `redis` (Bun's built-in client), or `memory`
 * (no cache — development only; refused in production by @core/config).
 */
/** One Redis connection per process, shared by every adapter that asks for it (lazy). */
let redis: (RedisLike & RedisCommands) | null | undefined;
function redisClient(): (RedisLike & RedisCommands) | null {
  if (redis !== undefined) return redis;
  const e = env();
  // Bun ships a Redis client; typed loosely here so the API package needs no extra dependency.
  redis = e.REDIS_URL
    ? new (
        Bun as unknown as { RedisClient: new (url: string) => RedisLike & RedisCommands }
      ).RedisClient(e.REDIS_URL)
    : null;
  return redis;
}
// Sessions and rate limits (Decision M, ROADMAP §8 item 7): Redis accelerators, chosen by env,
// resolved lazily on first use so importing the app never needs an environment.
configureSessionRedis(() => (env().SESSION_DRIVER === 'redis' ? redisClient() : null));
configureRateLimitRedis(() => (env().RATELIMIT_DRIVER === 'redis' ? redisClient() : null));

function cacheFor<T>(name: string) {
  const e = env();
  if (e.CACHE_DRIVER === 'redis' && e.REDIS_URL) {
    const client = redisClient();
    if (client) return new RedisCache<T>(client, `dab:${name}`, 300);
  }
  if (e.CACHE_DRIVER === 'memory') return new NoCache<T>();
  return undefined; // SettingsStore / ModuleStateStore default to the database version cache
}

/**
 * Created on first use, not at import: importing the app (unit tests, `bun check`, OpenAPI
 * generation) must not require a database connection string.
 */
function lazy<T extends object>(factory: () => T): T {
  let instance: T | null = null;
  return new Proxy({} as T, {
    get(_t, prop) {
      instance ??= factory();
      const v = (instance as Record<PropertyKey, unknown>)[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(instance) : v;
    },
  });
}

export const settings: SettingsStore = lazy(
  () => new SettingsStore(unsafeAcrossTenants(), cacheFor('config')),
);
/** Admin-assembled themes (L-24), read per request like configuration. */
export const customThemes: CustomThemeStore = lazy(
  () => new CustomThemeStore(unsafeAcrossTenants(), cacheFor('themes')),
);
export const moduleState: ModuleStateStore = lazy(
  () =>
    new ModuleStateStore(
      unsafeAcrossTenants(),
      modules.map((m) => m.name),
      cacheFor('modules'),
    ),
);

/** The event bus is created by index.ts; domains emit through this indirection. */
let bus: EventBus | null = null;
export function setBus(b: EventBus): void {
  bus = b;
}
/** The process bus when serving (null under `app.handle()` in tests / OpenAPI generation). */
export function getBus(): EventBus | null {
  return bus;
}
export function emit<E extends Parameters<EventBus['emit']>[0]>(
  event: E,
  payload: Parameters<EventBus['emit']>[1],
  meta?: Parameters<EventBus['emit']>[2],
): void {
  bus?.emit(event, payload as never, meta).catch(() => undefined);
}
