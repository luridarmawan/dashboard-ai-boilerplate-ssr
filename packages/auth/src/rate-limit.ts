import { and, type Db, eq, newId, schema, sql } from '@core/db';
import { rateLimitRedis, warnRedis } from './redis.ts';

/**
 * Fixed-window rate limiting (PRD A-2, N-7, Decision M).
 *
 *   database (default)  one row per key; the increment is a conditional UPDATE so concurrent
 *                       instances never lose counts
 *   redis               `INCR` on `crk:rl:<key>:<window>` + `PEXPIREAT` at the window end — the
 *                       same semantics, one round trip, no table growth; falls back to the
 *                       database when Redis errors (never fails open)
 */

const RL_PREFIX = 'crk:rl:';

export interface RateLimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** When the current window ends. */
  readonly resetAt: Date;
}

/** Parse `"10/900"` (10 requests per 900 s). */
export function parseRule(spec: string): RateLimitRule {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(spec.trim());
  if (!m)
    throw new Error(`rate limit rule "${spec}" tidak valid — pakai <limit>/<detik>, mis. 10/900`);
  return { limit: Number(m[1]), windowSeconds: Number(m[2]) };
}

/** Standard headers (draft-ietf-httpapi-ratelimit-headers) + Retry-After when blocked. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const reset = Math.max(0, Math.ceil((r.resetAt.getTime() - Date.now()) / 1000));
  const h: Record<string, string> = {
    'RateLimit-Limit': String(r.limit),
    'RateLimit-Remaining': String(Math.max(0, r.remaining)),
    'RateLimit-Reset': String(reset),
  };
  if (!r.allowed) h['Retry-After'] = String(reset);
  return h;
}

export async function consume(
  db: Db,
  key: string,
  rule: RateLimitRule,
  now = new Date(),
): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);

  const redis = rateLimitRedis();
  if (redis) {
    try {
      const rk = `${RL_PREFIX}${key}:${windowStart.getTime()}`;
      const count = Number(await redis.send('INCR', [rk]));
      // First hit of the window sets the expiry (a little past the window end, for clock skew).
      if (count === 1) await redis.send('PEXPIREAT', [rk, String(resetAt.getTime() + 1000)]);
      if (Number.isFinite(count))
        return {
          allowed: count <= rule.limit,
          limit: rule.limit,
          remaining: Math.max(0, rule.limit - count),
          resetAt,
        };
    } catch (err) {
      warnRedis('rate-limit', err);
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .select({ count: schema.rateLimits.count, window_start: schema.rateLimits.window_start })
      .from(schema.rateLimits)
      .where(eq(schema.rateLimits.key, key))
      .limit(1);

    if (!row) {
      try {
        await db
          .insert(schema.rateLimits)
          .values({ id: newId(), key, window_start: windowStart, count: 1 });
        return { allowed: true, limit: rule.limit, remaining: rule.limit - 1, resetAt };
      } catch {
        continue; // lost the insert race; re-read
      }
    }

    if (row.window_start.getTime() !== windowStart.getTime()) {
      // New window: reset atomically, guarded by the old window_start so only one writer wins.
      const res = await db
        .update(schema.rateLimits)
        .set({ window_start: windowStart, count: 1 })
        .where(
          and(eq(schema.rateLimits.key, key), eq(schema.rateLimits.window_start, row.window_start)),
        );
      if (affected(res) === 1)
        return { allowed: true, limit: rule.limit, remaining: rule.limit - 1, resetAt };
      continue;
    }

    if (row.count >= rule.limit)
      return { allowed: false, limit: rule.limit, remaining: 0, resetAt };

    const res = await db
      .update(schema.rateLimits)
      .set({ count: sql`${schema.rateLimits.count} + 1` })
      .where(and(eq(schema.rateLimits.key, key), eq(schema.rateLimits.window_start, windowStart)));
    if (affected(res) === 1)
      return { allowed: true, limit: rule.limit, remaining: rule.limit - row.count - 1, resetAt };
  }
  // Under pathological contention, fail closed: refusing one request is safer than admitting one too many.
  return { allowed: false, limit: rule.limit, remaining: 0, resetAt };
}

function affected(result: unknown): number {
  if (Array.isArray(result))
    return Number((result[0] as { affectedRows?: number })?.affectedRows ?? 0);
  return Number((result as { count?: number })?.count ?? 0);
}
