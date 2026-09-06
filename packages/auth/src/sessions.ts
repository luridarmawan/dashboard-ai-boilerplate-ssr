import { and, type Db, eq, gt, isNull, lt, newId, or, schema } from '@core/db';
import { hashToken, randomToken } from './tokens.ts';

/**
 * Server-side sessions, `SESSION_DRIVER=database` (PRD A-3, A-5, A-12, Decision M).
 *
 * Correct under multiple instances by construction: every lookup is a database read, there is
 * no per-process cache, so `--scale api=3` needs no sticky sessions. The Redis adapter, when it
 * comes, is an accelerator in front of the same table.
 */

export interface NewSession {
  readonly userId: string;
  readonly clientId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly ttlSeconds: number;
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
  });
  return { id, token, expiresAt };
}

/** Resolve a cookie token to a live session + its user, touching last_seen (throttled). Null when invalid. */
export async function findSession(
  db: Db,
  token: string,
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const now = new Date();
  const rows = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.user_id))
    .where(
      and(
        eq(schema.sessions.token_hash, hashToken(token)),
        gt(schema.sessions.expires_at, now),
        isNull(schema.sessions.revoked_at),
        isNull(schema.users.deleted_at),
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
  }
  return row;
}

export async function setActiveTenant(db: Db, sessionId: string, clientId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ client_id: clientId })
    .where(eq(schema.sessions.id, sessionId));
}

/** Logout: invalidate on the server, not merely delete the cookie (A-5). */
export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revoked_at: new Date() })
    .where(eq(schema.sessions.id, sessionId));
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
  return n;
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
