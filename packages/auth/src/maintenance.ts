import { and, type Db, eq, isNull, schema, tenantScope } from '@core/db';

/**
 * Who may still work while maintenance mode is on (E-10): a superadmin, and every live member of
 * the tenant's Administrator group — the seeded system group whose code is `admin` (O-3). A
 * permission would not do here: maintenance is the moment permissions are being repaired, so the
 * exemption is tied to the group itself, not to what it currently grants.
 */
export const MAINTENANCE_EXEMPT_GROUP = 'admin';

/**
 * May this user act during maintenance? Read from the database on every call — no per-process
 * cache (Decision M) — so adding someone to the Administrator group lets them in on their very
 * next request. Without a tenant nobody but a superadmin is exempt: group membership is per tenant.
 */
export async function isMaintenanceExempt(
  db: Db,
  user: { id: string; is_superadmin: boolean },
  clientId: string | null,
): Promise<boolean> {
  if (user.is_superadmin) return true;
  if (!clientId) return false;
  const t = tenantScope(db, clientId);
  const group = await t.selectOne(
    schema.groups,
    and(eq(schema.groups.code, MAINTENANCE_EXEMPT_GROUP), isNull(schema.groups.deleted_at)),
  );
  if (!group) return false;
  const membership = await t.selectOne(
    schema.groupUserMaps,
    and(eq(schema.groupUserMaps.group_id, group.id), eq(schema.groupUserMaps.user_id, user.id)),
  );
  return membership !== null;
}
