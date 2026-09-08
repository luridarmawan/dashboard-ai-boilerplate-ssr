/**
 * Optional Redis accelerators for sessions and rate limiting (Decision M, ROADMAP §8 item 7).
 *
 * The database stays the source of truth; Redis only makes the hot paths cheaper:
 *   - sessions: a short-lived cache of the resolved (session, user) pair in front of the join
 *   - rate limits: INCR + PEXPIREAT per window instead of a conditional UPDATE
 *
 * Both are fail-open towards the database: when Redis errors, the call falls back to the table
 * and a warning is logged once per minute, so a Redis outage never logs anyone out or admits
 * unlimited requests. Nothing here connects on its own — the API registers a provider (lazy, so
 * importing the package never needs an environment).
 */

/** The subset of a Redis client we use: one generic command sender (Bun.RedisClient has it). */
export interface RedisCommands {
  send(command: string, args: string[]): Promise<unknown>;
}

export type RedisProvider = () => RedisCommands | null;

let sessionProvider: RedisProvider = () => null;
let sessionTtlSeconds = 60;
let rateLimitProvider: RedisProvider = () => null;

/** Sessions: cache resolved sessions for `ttlSeconds` (default 60 s — the last_seen touch interval). */
export function configureSessionRedis(provider: RedisProvider, ttlSeconds = 60): void {
  sessionProvider = provider;
  sessionTtlSeconds = Math.max(5, ttlSeconds);
}
/** Rate limits: count windows in Redis instead of the `rate_limits` table. */
export function configureRateLimitRedis(provider: RedisProvider): void {
  rateLimitProvider = provider;
}

export function sessionRedis(): RedisCommands | null {
  try {
    return sessionProvider();
  } catch {
    return null;
  }
}
export function sessionCacheTtl(): number {
  return sessionTtlSeconds;
}
export function rateLimitRedis(): RedisCommands | null {
  try {
    return rateLimitProvider();
  } catch {
    return null;
  }
}

let lastWarn = 0;
/** One warning per minute per process; the fallback path is silent otherwise. */
export function warnRedis(where: string, err: unknown): void {
  const now = Date.now();
  if (now - lastWarn < 60_000) return;
  lastWarn = now;
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      level: 'warn',
      msg: 'redis unavailable — falling back to database',
      where,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/** Reset the providers (tests). */
export function resetRedisAdapters(): void {
  sessionProvider = () => null;
  rateLimitProvider = () => null;
  sessionTtlSeconds = 60;
  lastWarn = 0;
}
