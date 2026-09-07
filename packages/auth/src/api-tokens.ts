import { and, type Db, eq, gt, isNull, newId, or, STATUS, schema } from '@core/db';
import type { UserRow } from './sessions.ts';
import { hashToken, randomToken } from './tokens.ts';

/**
 * API tokens for non-browser clients (PRD A-4): MCP clients, mobile apps, services.
 *
 * A token is a bearer secret with its own expiry and optional scopes, minted by a logged-in user
 * for themselves. Only the SHA-256 hash is stored; the plaintext is shown once. Like sessions,
 * every lookup is a database read (no per-process cache), so `--scale api=3` is fine. A token
 * never grants more than its user has: scopes can only narrow the user's effective permissions.
 */

export type ApiTokenRow = typeof schema.apiTokens.$inferSelect;

export interface NewApiToken {
  readonly userId: string;
  /** Tenant the token acts in; null = the user's default tenant at call time. */
  readonly clientId: string | null;
  readonly name: string;
  /** Permission strings the token is limited to; null = the user's full permissions. */
  readonly scopes: readonly string[] | null;
  readonly expiresAt: Date | null;
}

export interface CreatedApiToken {
  readonly id: string;
  /** The bearer secret. Returned once; never stored, never logged. */
  readonly token: string;
  readonly expiresAt: Date | null;
}

/** Touch `last_used_at` at most this often. */
const TOUCH_INTERVAL_MS = 60_000;

export async function createApiToken(db: Db, t: NewApiToken): Promise<CreatedApiToken> {
  const token = randomToken();
  const id = newId();
  await db.insert(schema.apiTokens).values({
    id,
    user_id: t.userId,
    client_id: t.clientId,
    name: t.name.trim().slice(0, 100),
    token_hash: hashToken(token),
    scopes: t.scopes ? [...t.scopes] : null,
    expires_at: t.expiresAt,
    last_used_at: null,
  });
  return { id, token, expiresAt: t.expiresAt };
}

/** Resolve a bearer secret to a live token + its (active) user. Null when unknown, expired or revoked. */
export async function findApiToken(
  db: Db,
  token: string,
): Promise<{ token: ApiTokenRow; user: UserRow } | null> {
  const now = new Date();
  const rows = await db
    .select({ token: schema.apiTokens, user: schema.users })
    .from(schema.apiTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiTokens.user_id))
    .where(
      and(
        eq(schema.apiTokens.token_hash, hashToken(token)),
        isNull(schema.apiTokens.deleted_at),
        or(isNull(schema.apiTokens.expires_at), gt(schema.apiTokens.expires_at, now)),
        isNull(schema.users.deleted_at),
        eq(schema.users.status_id, STATUS.ACTIVE),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const last = row.token.last_used_at?.getTime() ?? 0;
  if (now.getTime() - last > TOUCH_INTERVAL_MS) {
    await db
      .update(schema.apiTokens)
      .set({ last_used_at: now })
      .where(eq(schema.apiTokens.id, row.token.id));
  }
  return row;
}

/** The user's live tokens, newest first — never the hash. */
export async function listApiTokens(db: Db, userId: string): Promise<ApiTokenRow[]> {
  const rows = await db
    .select()
    .from(schema.apiTokens)
    .where(and(eq(schema.apiTokens.user_id, userId), isNull(schema.apiTokens.deleted_at)));
  return rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

/** Revoke one of the user's tokens. Returns false when it is not theirs (or already gone). */
export async function revokeApiToken(db: Db, userId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.apiTokens.id })
    .from(schema.apiTokens)
    .where(
      and(
        eq(schema.apiTokens.id, id),
        eq(schema.apiTokens.user_id, userId),
        isNull(schema.apiTokens.deleted_at),
      ),
    )
    .limit(1);
  if (!row) return false;
  await db
    .update(schema.apiTokens)
    .set({ deleted_at: new Date() })
    .where(eq(schema.apiTokens.id, id));
  return true;
}

/** The tenant a token without `client_id` acts in: the user's default membership, else their first. */
export async function defaultTenantOf(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({
      clientId: schema.clientUserMaps.client_id,
      isDefault: schema.clientUserMaps.is_default,
    })
    .from(schema.clientUserMaps)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.clientUserMaps.client_id))
    .where(
      and(
        eq(schema.clientUserMaps.user_id, userId),
        isNull(schema.clientUserMaps.deleted_at),
        isNull(schema.clients.deleted_at),
      ),
    );
  return rows.find((r) => r.isDefault)?.clientId ?? rows[0]?.clientId ?? null;
}
