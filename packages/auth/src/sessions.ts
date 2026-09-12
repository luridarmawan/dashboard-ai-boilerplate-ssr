import { and, type Db, eq, gt, inArray, isNull, lt, newId, or, STATUS, schema } from '@core/db';
import { sessionCacheTtl, sessionRedis, warnRedis } from './redis.ts';
import { hashToken, randomToken } from './tokens.ts';

/**
 * Server-side sessions, `SESSION_DRIVER=database` (PRD A-3, A-5, A-12, Decision M).
 *
 * Correct under multiple instances by construction: every lookup is a database read, there is
 * no per-process cache, so `--scale api=3` needs no sticky sessions. With `SESSION_DRIVER=redis`
 * the resolved (session, user) pair is cached in Redis for one touch interval in front of the SAME
 * table: logins, revocations and tenant switches still land in the database, and every write path
 * below evicts the cached copies it affects. Redis down = plain database behaviour.
 */

const CACHE_PREFIX = 'crk:sess:';
const keyFor = (tokenHash: string) => `${CACHE_PREFIX}${tokenHash}`;
const idKey = (sessionId: string) => `${CACHE_PREFIX}id:${sessionId}`;
const userKey = (userId: string) => `${CACHE_PREFIX}u:${userId}`;

type Cached = { session: SessionRow; user: UserRow };
const DATE_FIELDS = new Set([
  'expires_at',
  'last_seen_at',
  'revoked_at',
  'created_at',
  'updated_at',
  'deleted_at',
  'email_verified_at',
  'last_login_at',
]);
function revive<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out))
    if (DATE_FIELDS.has(k) && typeof out[k] === 'string') out[k] = new Date(out[k] as string);
  return out as T;
}

async function cacheGet(tokenHash: string): Promise<Cached | null> {
  const r = sessionRedis();
  if (!r) return null;
  try {
    const raw = await r.send('GET', [keyFor(tokenHash)]);
    if (typeof raw !== 'string') return null;
    const c = JSON.parse(raw) as Cached;
    return { session: revive(c.session), user: revive(c.user) };
  } catch (err) {
    warnRedis('sessions.get', err);
    return null;
  }
}
async function cachePut(tokenHash: string, value: Cached): Promise<void> {
  const r = sessionRedis();
  if (!r) return;
  try {
    const ttl = String(sessionCacheTtl());
    await r.send('SET', [keyFor(tokenHash), JSON.stringify(value), 'EX', ttl]);
    await r.send('SET', [idKey(value.session.id), tokenHash, 'EX', ttl]);
    // Per-user index for revoke-all; lives as long as the longest possible session.
    await r.send('SADD', [userKey(value.user.id), tokenHash]);
    await r.send('EXPIRE', [userKey(value.user.id), String(sessionCacheTtl() * 2)]);
  } catch (err) {
    warnRedis('sessions.put', err);
  }
}
async function evictSession(sessionId: string): Promise<void> {
  const r = sessionRedis();
  if (!r) return;
  try {
    const hash = await r.send('GET', [idKey(sessionId)]);
    const keys = [idKey(sessionId)];
    if (typeof hash === 'string') keys.push(keyFor(hash));
    await r.send('DEL', keys);
  } catch (err) {
    warnRedis('sessions.evict', err);
  }
}
async function evictUser(userId: string): Promise<void> {
  const r = sessionRedis();
  if (!r) return;
  try {
    const hashes = await r.send('SMEMBERS', [userKey(userId)]);
    const keys = [userKey(userId)];
    if (Array.isArray(hashes))
      for (const h of hashes) if (typeof h === 'string') keys.push(keyFor(h));
    await r.send('DEL', keys);
  } catch (err) {
    warnRedis('sessions.evictUser', err);
  }
}

export interface NewSession {
  readonly userId: string;
  readonly clientId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly ttlSeconds: number;
  /** Superadmin acting as this user (D-6). */
  readonly impersonatorId?: string | null;
}

export interface CreatedSession {
  readonly id: string;
  /** The secret for the cookie. Never stored; never logged. */
  readonly token: string;
  readonly expiresAt: Date;
}

export type SessionRow = typeof schema.sessions.$inferSelect;
export type UserRow = typeof schema.users.$inferSelect;

/** Touch `last_seen_at` at most this often, to keep reads from turning into writes. */
const TOUCH_INTERVAL_MS = 60_000;

export async function createSession(db: Db, s: NewSession): Promise<CreatedSession> {
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + s.ttlSeconds * 1000);
  const id = newId();
  await db.insert(schema.sessions).values({
    id,
    user_id: s.userId,
    client_id: s.clientId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
    last_seen_at: now,
    ip: s.ip,
    user_agent: s.userAgent?.slice(0, 512) ?? null,
    impersonator_id: s.impersonatorId ?? null,
  });
  return { id, token, expiresAt };
}

/** Resolve a cookie token to a live session + its user, touching last_seen (throttled). Null when invalid. */
export async function findSession(
  db: Db,
  token: string,
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const now = new Date();
  const tokenHash = hashToken(token);
  const cached = await cacheGet(tokenHash);
  if (cached) {
    // The cache never outlives the session: the TTL is short, and expiry is still checked here.
    if (cached.session.expires_at.getTime() > now.getTime() && !cached.session.revoked_at)
      return cached;
    await evictSession(cached.session.id);
  }
  const rows = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.user_id))
    .where(
      and(
        eq(schema.sessions.token_hash, tokenHash),
        gt(schema.sessions.expires_at, now),
        isNull(schema.sessions.revoked_at),
        isNull(schema.users.deleted_at),
        eq(schema.users.status_id, STATUS.ACTIVE), // deactivation takes effect on the next request
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (now.getTime() - row.session.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(schema.sessions)
      .set({ last_seen_at: now })
      .where(eq(schema.sessions.id, row.session.id));
    row.session.last_seen_at = now;
  }
  await cachePut(tokenHash, row);
  return row;
}

export async function setActiveTenant(db: Db, sessionId: string, clientId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ client_id: clientId })
    .where(eq(schema.sessions.id, sessionId));
  await evictSession(sessionId);
}

/**
 * A tenant went away (deleted, or the user left it): sessions parked on it fall back to "no active
 * tenant" on their next request. Scoped to one user when given.
 */
export async function detachTenantFromSessions(
  db: Db,
  clientId: string,
  userId?: string,
): Promise<number> {
  const where = userId
    ? and(eq(schema.sessions.client_id, clientId), eq(schema.sessions.user_id, userId))
    : eq(schema.sessions.client_id, clientId);
  const affected = await db
    .select({ id: schema.sessions.id, user_id: schema.sessions.user_id })
    .from(schema.sessions)
    .where(where);
  if (!affected.length) return 0;
  await db
    .update(schema.sessions)
    .set({ client_id: null })
    .where(
      inArray(
        schema.sessions.id,
        affected.map((s) => s.id),
      ),
    );
  for (const uid of new Set(affected.map((s) => s.user_id))) await evictUser(uid);
  return affected.length;
}

/** Logout: invalidate on the server, not merely delete the cookie (A-5). */
export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revoked_at: new Date() })
    .where(eq(schema.sessions.id, sessionId));
  await evictSession(sessionId);
}

export async function revokeAllSessions(
  db: Db,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.user_id, userId), isNull(schema.sessions.revoked_at)));
  let n = 0;
  for (const r of rows) {
    if (r.id === exceptSessionId) continue;
    await revokeSession(db, r.id);
    n++;
  }
  await evictUser(userId); // the surviving session re-reads its user row on the next request
  return n;
}

/**
 * Call after ANY write to a `users` row (name, locale, theme, avatar, status, password): the
 * Redis session cache holds a copy of that row and must not serve it stale. No-op without Redis.
 */
export async function invalidateUserSessions(userId: string): Promise<void> {
  await evictUser(userId);
}

/** Scheduled job body (`core.sessions.cleanup`): drop rows that are expired or revoked for a while. */
export async function cleanupExpiredSessions(db: Db, olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const stale = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(or(lt(schema.sessions.expires_at, cutoff), lt(schema.sessions.revoked_at, cutoff)));
  for (const r of stale) await db.delete(schema.sessions).where(eq(schema.sessions.id, r.id));
  return stale.length;
}
