import { and, type Db, eq, isNull, newId, schema } from '@core/db';
import { hashPassword } from './password.ts';
import { isValidPermission } from './permissions.ts';
import { isRegistered } from './registry.ts';

/**
 * Idempotent seed (PRD O-3, C-5, B-5). Safe to run on every deploy:
 *   - tenant `default`
 *   - groups `admin` (*.*) and `user` (a small self-service set) in that tenant, `is_system`
 *   - the first superadmin from BOOTSTRAP_ADMIN_EMAIL / _PASSWORD, member of `default` and `admin`
 * Existing rows are left alone (passwords are never overwritten). Every seeded permission must be
 * a wildcard or registered (C-4) — a typo fails the seed instead of silently granting nothing.
 */

export interface SeedOptions {
  readonly adminEmail?: string;
  readonly adminPassword?: string;
  readonly log?: (msg: string) => void;
}

export interface SeedResult {
  readonly tenantId: string;
  readonly adminGroupId: string;
  readonly userGroupId: string;
  readonly adminUserId: string | null;
  readonly created: string[];
}

export const SYSTEM_GROUPS = [
  { code: 'admin', name: 'Administrator', permissions: ['*.*'] },
  { code: 'user', name: 'Regular User', permissions: ['user.read'] },
] as const;

export async function runSeed(db: Db, opts: SeedOptions = {}): Promise<SeedResult> {
  const log = opts.log ?? (() => {});
  const created: string[] = [];

  for (const g of SYSTEM_GROUPS) {
    for (const p of g.permissions) {
      if (!isValidPermission(p)) throw new Error(`seed: izin "${p}" tidak valid`);
      if (!p.includes('*') && !isRegistered(p))
        throw new Error(`seed: izin "${p}" tidak terdaftar di registry (C-4)`);
    }
  }

  // ---- tenant ----
  let [tenant] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.code, 'default'))
    .limit(1);
  if (!tenant) {
    const id = newId();
    await db.insert(schema.clients).values({ id, code: 'default', name: 'Default' });
    [tenant] = await db.select().from(schema.clients).where(eq(schema.clients.id, id)).limit(1);
    created.push('client:default');
    log('tenant default dibuat');
  }
  if (!tenant) throw new Error('seed: tenant default gagal dibuat');
  const tenantId = tenant.id;

  // ---- groups + permissions ----
  const groupIds: Record<string, string> = {};
  for (const g of SYSTEM_GROUPS) {
    let [row] = await db
      .select()
      .from(schema.groups)
      .where(and(eq(schema.groups.client_id, tenantId), eq(schema.groups.code, g.code)))
      .limit(1);
    if (!row) {
      const id = newId();
      await db
        .insert(schema.groups)
        .values({ id, client_id: tenantId, code: g.code, name: g.name, is_system: true });
      [row] = await db.select().from(schema.groups).where(eq(schema.groups.id, id)).limit(1);
      created.push(`group:${g.code}`);
      log(`grup ${g.code} dibuat`);
    }
    if (!row) throw new Error(`seed: grup ${g.code} gagal dibuat`);
    groupIds[g.code] = row.id;
    const existing = await db
      .select({ permission: schema.groupPermissions.permission })
      .from(schema.groupPermissions)
      .where(
        and(
          eq(schema.groupPermissions.client_id, tenantId),
          eq(schema.groupPermissions.group_id, row.id),
        ),
      );
    const have = new Set(existing.map((e) => e.permission));
    for (const p of g.permissions) {
      if (have.has(p)) continue;
      await db
        .insert(schema.groupPermissions)
        .values({ id: newId(), client_id: tenantId, group_id: row.id, permission: p });
      created.push(`permission:${g.code}:${p}`);
    }
  }
  const adminGroupId = groupIds.admin as string;
  const userGroupId = groupIds.user as string;

  // ---- bootstrap superadmin (C-5) ----
  let adminUserId: string | null = null;
  if (opts.adminEmail && opts.adminPassword) {
    const email = opts.adminEmail.trim().toLowerCase();
    let [u] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!u) {
      const id = newId();
      await db.insert(schema.users).values({
        id,
        email,
        name: 'Administrator',
        password_hash: await hashPassword(opts.adminPassword),
        is_superadmin: true,
        email_verified_at: new Date(),
      });
      [u] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
      created.push(`user:${email}`);
      log(`superadmin ${email} dibuat`);
    } else if (!u.is_superadmin) {
      await db.update(schema.users).set({ is_superadmin: true }).where(eq(schema.users.id, u.id));
      created.push(`user:${email}:superadmin`);
    }
    if (!u) throw new Error('seed: superadmin gagal dibuat');
    adminUserId = u.id;

    const [map] = await db
      .select({ id: schema.clientUserMaps.id })
      .from(schema.clientUserMaps)
      .where(
        and(
          eq(schema.clientUserMaps.client_id, tenantId),
          eq(schema.clientUserMaps.user_id, u.id),
          isNull(schema.clientUserMaps.deleted_at),
        ),
      )
      .limit(1);
    if (!map) {
      await db
        .insert(schema.clientUserMaps)
        .values({ id: newId(), client_id: tenantId, user_id: u.id, is_default: true });
      created.push('membership:admin:default');
    }
    const [gm] = await db
      .select({ id: schema.groupUserMaps.id })
      .from(schema.groupUserMaps)
      .where(
        and(
          eq(schema.groupUserMaps.client_id, tenantId),
          eq(schema.groupUserMaps.group_id, adminGroupId),
          eq(schema.groupUserMaps.user_id, u.id),
        ),
      )
      .limit(1);
    if (!gm) {
      await db
        .insert(schema.groupUserMaps)
        .values({ id: newId(), client_id: tenantId, group_id: adminGroupId, user_id: u.id });
      created.push('group-member:admin');
    }
  }

  return { tenantId, adminGroupId, userGroupId, adminUserId, created };
}
