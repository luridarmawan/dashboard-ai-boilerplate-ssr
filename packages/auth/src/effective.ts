import { and, type Db, eq, isNull, schema, tenantScope } from '@core/db';
import { normalizeGrants } from './permissions.ts';

/**
 * Effective permissions of a user inside ONE tenant (PRD C-3, C-5, C-7).
 *
 * Superadmin (`users.is_superadmin`) is `*.*` everywhere. Everyone else gets the union of the
 * permissions of the groups they belong to in that tenant — read through the tenant facade, so
 * a group from another tenant can never leak in (B-3). Computed per request from the database:
 * a permission change takes effect on the very next request, on every instance (Decision M).
 */
export async function effectivePermissions(
  db: Db,
  user: { id: string; is_superadmin: boolean },
  clientId: string | null,
): Promise<string[]> {
  if (user.is_superadmin) return ['*.*'];
  if (!clientId) return [];
  const t = tenantScope(db, clientId);
  const memberships = await t.select(
    schema.groupUserMaps,
    eq(schema.groupUserMaps.user_id, user.id),
  );
  if (memberships.length === 0) return [];
  const grants = new Set<string>();
  for (const m of memberships) {
    const group = await t.selectOne(
      schema.groups,
      and(eq(schema.groups.id, m.group_id), isNull(schema.groups.deleted_at)),
    );
    if (!group) continue;
    const perms = await t.select(
      schema.groupPermissions,
      eq(schema.groupPermissions.group_id, m.group_id),
    );
    for (const p of perms) grants.add(p.permission);
  }
  return normalizeGrants(grants);
}

/** Is `userId` a live member of tenant `clientId`? The check behind X-Client-ID and switching (B-2, B-4). */
export async function isMemberOf(db: Db, userId: string, clientId: string): Promise<boolean> {
  const t = tenantScope(db, clientId);
  const row = await t.selectOne(
    schema.clientUserMaps,
    and(eq(schema.clientUserMaps.user_id, userId), isNull(schema.clientUserMaps.deleted_at)),
  );
  if (!row) return false;
  const client = await t.selectOne(
    schema.clients,
    and(eq(schema.clients.id, clientId), isNull(schema.clients.deleted_at)),
  );
  return client !== null;
}

/**
 * May this user act in `clientId`? Members may; a superadmin may in ANY live tenant (C-5) —
 * membership is how tenants are administered, not a wall the platform owner runs into.
 */
export async function canActInTenant(
  db: Db,
  user: { id: string; is_superadmin: boolean },
  clientId: string,
): Promise<boolean> {
  if (user.is_superadmin) {
    const [c] = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.id, clientId), isNull(schema.clients.deleted_at)))
      .limit(1);
    return !!c;
  }
  return isMemberOf(db, user.id, clientId);
}

export interface TenantSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isDefault: boolean;
}

/** Tenants a user may act in, for the switcher (B-4). Deliberately reads ACROSS tenants. */
export async function tenantsOf(db: Db, userId: string): Promise<TenantSummary[]> {
  return db
    .select({
      id: schema.clients.id,
      code: schema.clients.code,
      name: schema.clients.name,
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
}
