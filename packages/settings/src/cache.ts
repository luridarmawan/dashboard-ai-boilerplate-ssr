import { type Db, eq, schema, sql } from '@core/db';

/**
 * Cache adapters for configuration (PRD E-5, Decision M). Both expose the same contract:
 * `get()` returns a still-valid in-memory copy or null; `set()` stores one; `invalidate()`
 * makes every instance drop its copy. Saving configuration ALWAYS calls `invalidate()`.
 *
 *   database — a `cache_versions` row per name. The memory copy is used only while the version
 *              it was built for still equals the row's version: one indexed read per lookup,
 *              no Redis, N instances converge on the next request. Closes D1.
 *   redis    — TTL + explicit DEL on save (Bun's built-in client, `Bun.redis`).
 */
export interface CacheAdapter<T> {
  get(): Promise<T | null>;
  set(value: T): Promise<void>;
  invalidate(): Promise<void>;
}

export class DatabaseVersionCache<T> implements CacheAdapter<T> {
  private copy: { version: number; value: T } | null = null;
  constructor(
    private readonly db: Db,
    private readonly name: string,
  ) {}

  private async version(): Promise<number> {
    const [row] = await this.db
      .select({ version: schema.cacheVersions.version })
      .from(schema.cacheVersions)
      .where(eq(schema.cacheVersions.name, this.name))
      .limit(1);
    if (row) return row.version;
    // First use: create the counter. A race with another instance is harmless (unique index).
    await this.db
      .insert(schema.cacheVersions)
      .values({ id: crypto.randomUUID(), name: this.name, version: 1 })
      .catch(() => undefined);
    return 1;
  }

  async get(): Promise<T | null> {
    const v = await this.version();
    if (this.copy && this.copy.version === v) return this.copy.value;
    this.copy = null;
    return null;
  }

  async set(value: T): Promise<void> {
    this.copy = { version: await this.version(), value };
  }

  /** Bump the shared counter: every instance's copy is stale from this moment. */
  async invalidate(): Promise<void> {
    await this.version(); // ensure the row exists
    await this.db
      .update(schema.cacheVersions)
      .set({ version: sql`${schema.cacheVersions.version} + 1` })
      .where(eq(schema.cacheVersions.name, this.name));
    this.copy = null;
  }
}

/** Minimal Redis surface we need — satisfied by `Bun.redis` (RedisClient). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex?: 'EX', seconds?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class RedisCache<T> implements CacheAdapter<T> {
  constructor(
    private readonly redis: RedisLike,
    private readonly key: string,
    private readonly ttlSeconds = 300,
  ) {}
  async get(): Promise<T | null> {
    const raw = await this.redis.get(this.key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  async set(value: T): Promise<void> {
    await this.redis.set(this.key, JSON.stringify(value), 'EX', this.ttlSeconds);
  }
  async invalidate(): Promise<void> {
    await this.redis.del(this.key);
  }
}

/** Never caches — for tests and for `CACHE_DRIVER=memory` (dev only; refused in production). */
export class NoCache<T> implements CacheAdapter<T> {
  async get(): Promise<T | null> {
    return null;
  }
  async set(): Promise<void> {}
  async invalidate(): Promise<void> {}
}
