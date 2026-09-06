import { env } from '@core/config';
import { unsafeAcrossTenants } from '@core/db';
import { modules } from '@core/module-kit/registry';
import type { EventBus } from '@core/runtime';
import {
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
function cacheFor<T>(name: string) {
  const e = env();
  if (e.CACHE_DRIVER === 'redis' && e.REDIS_URL) {
    // Bun ships a Redis client; typed loosely here so the API package needs no extra dependency.
    const client = new (
      Bun as unknown as { RedisClient: new (url: string) => RedisLike }
    ).RedisClient(e.REDIS_URL);
    return new RedisCache<T>(client, `dab:${name}`, 300);
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
export function emit<E extends Parameters<EventBus['emit']>[0]>(
  event: E,
  payload: Parameters<EventBus['emit']>[1],
  meta?: Parameters<EventBus['emit']>[2],
): void {
  bus?.emit(event, payload as never, meta).catch(() => undefined);
}
