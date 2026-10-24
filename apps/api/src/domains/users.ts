import {
  allPermissionStrings,
  canActInTenant,
  createSession,
  defaultTenantOf,
  detachTenantFromSessions,
  effectivePermissions,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hashRecoveryCode,
  hashToken,
  hasPermission,
  invalidateUserSessions,
  isMemberOf,
  otpauthUrl,
  passwordProblems,
  randomToken,
  revokeAllSessions,
  revokeSession,
  tenantsOf,
  verifyTotp,
  writeAudit,
} from '@core/auth';
import {
  AdminPasswordSetBody,
  errorResponses,
  fail,
  isUndeliverableEmail,
  MfaCodeBody,
  MfaDisableBody,
  OkSchema,
  ok,
  PageSchema,
  PasswordChangeBody,
  ProfileBody,
  page,
  UserCreateBody,
  UserUpdateBody,
} from '@core/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  forTenant,
  inArray,
  isNull,
  newId,
  or,
  STATUS,
  schema,
  sql,
  type TenantDb,
  unsafeAcrossTenants,
} from '@core/db';
import { Elysia, t } from 'elysia';
import { fileIdFromUrl, findAvatarFile, removeFile, storeUpload } from '../files.ts';
import { conflict, Id, ListQuery, likePattern, notFound, paging, scopeOf } from '../lib/http.ts';
import { isIpLiteral, lookupIp } from '../lib/ip-lookup.ts';
import { mailLocale, publicLink, sendTemplate } from '../mail.ts';
import { checkPassword } from '../passwords.ts';
import {
  type AuthState,
  clientIp,
  IMPERSONATE_COOKIE,
  notImpersonating,
  publicUser,
} from '../plugins/auth.ts';
import { cookieAttributes } from '../plugins/csrf.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, type TenantState, tenantContext } from '../plugins/tenancy.ts';
import { emit, settings } from '../services.ts';

/** Avatars are small by construction: 2 MB caps even a generous PNG. */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** A link an admin mails on someone's behalf waits for its reader: a day, like a new account's. */
const ADMIN_RESET_LINK_TTL_MS = 24 * 3600_000;

/** Phone (D-4) is typed free-form; only the digits and a leading `+` are stored. */
const normalizePhone = (v: string | null | undefined) =>
  v === undefined || v === null || v.trim() === '' ? null : v.replace(/[ -]/g, '');

/**
 * Users inside the ACTIVE tenant (PRD D-1) and the caller's own profile (D-4).
 *
 * A user is a global row; "a user of this tenant" is a live `client_user_maps` row. Every list
 * and lookup here goes through that map with the tenant condition, so a user id from another
 * tenant is simply "not found" — never leaked, never editable (B-3). Removing a user from a
 * tenant is a soft delete of the membership; the account itself is soft-deleted only when no
 * membership remains. Every mutation is audited with before/after (M-2).
 */

const SORT = {
  name: schema.users.name,
  email: schema.users.email,
  created_at: schema.users.created_at,
  last_login_at: schema.users.last_login_at,
  last_active_at: schema.users.last_active_at,
} as const;
const sortColumn = (key: string | undefined) =>
  key && key in SORT ? SORT[key as keyof typeof SORT] : SORT.name;

/**
 * The list query plus `group` (a group id of the active tenant; only its members are returned)
 * and `status` (a `status_id` value, see STATUS; only accounts in that state are returned).
 */
const UsersListQuery = t.Composite([
  ListQuery,
  t.Object({
    group: t.Optional(t.String({ maxLength: 36 })),
    status: t.Optional(t.Numeric({ minimum: 0, maximum: 2 })),
  }),
]);

const PublicUser = t.Object({
  id: t.String(),
  email: t.String(),
  name: t.String(),
  phone: t.Nullable(t.String()),
  avatarUrl: t.Nullable(t.String()),
  /** NULL until the user picks a language themselves (K-2). */
  locale: t.Nullable(t.String()),
  theme: t.Nullable(t.String()),
  sidebarCollapsed: t.Boolean(),
  isSuperadmin: t.Boolean(),
  emailVerifiedAt: t.Nullable(t.String()),
  lastLoginAt: t.Nullable(t.String()),
  /** Address of that login; null before the first login or when the proxy sent none. */
  lastLoginIp: t.Nullable(t.String()),
  /** Newest request of any session, kept on the account (outlives session purge); login counts. */
  lastActiveAt: t.Nullable(t.String()),
  lastActiveIp: t.Nullable(t.String()),
  createdAt: t.String(),
});
const TenantUser = t.Intersect([
  PublicUser,
  t.Object({
    statusId: t.Integer(),
    groups: t.Array(t.Object({ id: t.String(), code: t.String(), name: t.String() })),
    /** D-5: newest `sessions.last_seen_at` of this account, live or not; null once purged. */
    lastSeenAt: t.Nullable(t.String()),
    /** D-5: a live session touched within ONLINE_WINDOW — "here now", not "has an account". */
    online: t.Boolean(),
  }),
]);

/** Rough location of an IP (the "?" next to the user list's IP columns). */
const IpInfoSchema = t.Object({
  ip: t.String(),
  private: t.Boolean(),
  city: t.Nullable(t.String()),
  region: t.Nullable(t.String()),
  country: t.Nullable(t.String()),
  countryCode: t.Nullable(t.String()),
  isp: t.Nullable(t.String()),
  asn: t.Nullable(t.String()),
});

/**
 * Presence (D-5). `last_seen_at` is touched at most once a minute per session
 * (`TOUCH_INTERVAL_MS` in @core/auth), so the window has to be comfortably wider than that;
 * five minutes reads as "still here" without calling someone online who closed the tab.
 */
const ONLINE_WINDOW_MS = 5 * 60_000;

interface Presence {
  readonly lastSeenAt: Date;
  readonly online: boolean;
}

/**
 * One query for a whole page of users, not one per row: every session row of these accounts,
 * reduced here. `online` counts only sessions that are still live (not revoked, not expired),
 * while `lastSeenAt` is the newest touch of any session — a logged-out user still has a last
 * time they were around, which is exactly what the column is for.
 */
async function presenceOf(userIds: readonly string[]): Promise<Map<string, Presence>> {
  const out = new Map<string, Presence>();
  if (!userIds.length) return out;
  const db = unsafeAcrossTenants(); // sessions is a global table
  const rows = await db
    .select({
      userId: schema.sessions.user_id,
      lastSeenAt: schema.sessions.last_seen_at,
      expiresAt: schema.sessions.expires_at,
      revokedAt: schema.sessions.revoked_at,
    })
    .from(schema.sessions)
    .where(inArray(schema.sessions.user_id, [...new Set(userIds)]));
  const now = Date.now();
  for (const r of rows) {
    const live = !r.revokedAt && r.expiresAt.getTime() > now;
    const fresh = now - r.lastSeenAt.getTime() < ONLINE_WINDOW_MS;
    const prev = out.get(r.userId);
    out.set(r.userId, {
      lastSeenAt:
        prev && prev.lastSeenAt.getTime() > r.lastSeenAt.getTime() ? prev.lastSeenAt : r.lastSeenAt,
      online: (prev?.online ?? false) || (live && fresh),
    });
  }
  return out;
}

type UserRow = typeof schema.users.$inferSelect;

// ---- 2FA (A-11) ----
const MfaStatus = t.Object({
  enabled: t.Boolean(),
  /** Setup started (secret issued) but not yet confirmed with a code. */
  pending: t.Boolean(),
  recoveryCodesLeft: t.Integer(),
});
function mfaStatus(row: typeof schema.userMfa.$inferSelect | undefined) {
  const codes = row?.recovery_codes;
  const left = Array.isArray(codes) ? codes.length : 0;
  return {
    enabled: !!row?.enabled_at,
    pending: !!row && !row.enabled_at,
    recoveryCodesLeft: row?.enabled_at ? left : 0,
  };
}
/** Impersonated sessions live one hour at most (D-6). */
const IMPERSONATION_TTL_S = 3600;
const sessionGuard = ({
  auth,
  set,
  requestId,
}: {
  auth: AuthState | null;
  set: { status?: number | string };
  requestId: string;
}) => {
  if (auth) return;
  set.status = 401;
  return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', requestId);
};

function actor(auth: AuthState | null): AuthState {
  if (!auth) throw new Error('guard missing: route reached without a session');
  return auth;
}
function tenantOf(ts: TenantState | undefined) {
  if (!ts?.tenant || !ts.clientId) return null;
  return { tenant: ts.tenant, clientId: ts.clientId };
}

/** Groups of `userId` in the active tenant. */
async function groupsOf(tenant: TenantState['tenant'], userId: string) {
  if (!tenant) return [];
  const db = unsafeAcrossTenants(); // join; tenant condition is explicit below
  return db
    .select({ id: schema.groups.id, code: schema.groups.code, name: schema.groups.name })
    .from(schema.groupUserMaps)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupUserMaps.group_id))
    .where(
      and(
        scopeOf(tenant, schema.groupUserMaps),
        eq(schema.groupUserMaps.user_id, userId),
        isNull(schema.groups.deleted_at),
      ),
    );
}

/** A user row IF it is a live member of the active tenant, else null (404 upstream). */
async function memberRow(tenant: TenantState['tenant'], userId: string): Promise<UserRow | null> {
  if (!tenant) return null;
  const db = unsafeAcrossTenants(); // join; tenant condition is explicit below
  const [row] = await db
    .select({ user: schema.users })
    .from(schema.clientUserMaps)
    .innerJoin(schema.users, eq(schema.users.id, schema.clientUserMaps.user_id))
    .where(
      and(
        scopeOf(tenant, schema.clientUserMaps),
        eq(schema.clientUserMaps.user_id, userId),
        isNull(schema.clientUserMaps.deleted_at),
        isNull(schema.users.deleted_at),
      ),
    )
    .limit(1);
  return row?.user ?? null;
}

async function tenantUser(
  tenant: TenantState['tenant'],
  u: UserRow,
  presence?: ReadonlyMap<string, Presence>,
) {
  const seen = presence?.get(u.id) ?? null;
  return {
    ...publicUser(u),
    statusId: u.status_id,
    groups: await groupsOf(tenant, u.id),
    lastSeenAt: seen?.lastSeenAt.toISOString() ?? null,
    online: seen?.online ?? false,
  };
}

/** Replace the user's group memberships in the active tenant; unknown group ids → error string. */
async function setGroups(
  ts: { tenant: NonNullable<TenantState['tenant']>; clientId: string },
  userId: string,
  groupIds: string[],
): Promise<string | null> {
  const wanted = [...new Set(groupIds)];
  if (wanted.length) {
    const found = await ts.tenant.select(
      schema.groups,
      and(inArray(schema.groups.id, wanted), isNull(schema.groups.deleted_at)),
    );
    if (found.length !== wanted.length) return 'Ada grup yang tidak ditemukan di tenant ini';
  }
  await ts.tenant.delete(schema.groupUserMaps, eq(schema.groupUserMaps.user_id, userId));
  if (wanted.length) {
    await ts.tenant.insert(
      schema.groupUserMaps,
      wanted.map((group_id) => ({ id: newId(), group_id, user_id: userId })),
    );
  }
  return null;
}

// ---- tenant access (B-2, B-4) -------------------------------------------------------------------

/** The group a new membership lands in: the tenant's Regular User group, as an invitation does. */
const DEFAULT_GROUP_CODE = 'user';

const TenantRef = t.Object({ id: t.String(), code: t.String(), name: t.String() });
const TenantAccess = t.Intersect([
  TenantRef,
  t.Object({
    /** Opened after login when the user has several tenants (B-4). */
    isDefault: t.Boolean(),
    /** May the caller revoke this membership (`user.manage` there, not oneself, superadmin rules)? */
    canRemove: t.Boolean(),
  }),
]);
const UserTenants = t.Object({
  /** Live memberships in tenants the CALLER may act in \u2014 the rest are counted, never named (B-3). */
  memberships: t.Array(TenantAccess),
  hidden: t.Integer(),
  /** Tenants of the caller where this user is not a member yet and the caller holds `user.create`. */
  candidates: t.Array(TenantRef),
});

/**
 * Permission of the caller in a tenant that is NOT necessarily the active one. Same rule as the
 * route guard: effective permissions there, narrowed by an API token's scopes (A-4); a superadmin
 * passes everything (C-5). Membership comes first: a permission in a tenant one cannot act in is
 * no permission.
 */
async function canInTenant(a: AuthState, clientId: string, required: string): Promise<boolean> {
  const db = unsafeAcrossTenants(); // membership + permissions are read across tenants by definition
  if (!(await canActInTenant(db, a.user, clientId))) return false;
  if (a.scopes && !hasPermission(a.scopes, required)) return false;
  return (
    a.user.is_superadmin ||
    hasPermission(await effectivePermissions(db, a.user, clientId), required)
  );
}

/** Live memberships of `userId`, with the tenant, across every tenant (the caller filters). */
async function membershipsOf(userId: string) {
  const db = unsafeAcrossTenants(); // deliberately across tenants: that is the question being asked
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
    )
    .orderBy(asc(schema.clients.name));
}

/**
 * Take `userId` out of ONE tenant: groups there dropped, membership soft-deleted, sessions pinned
 * to that tenant detached; the account itself is soft-deleted (and every session ended) once no
 * membership remains. Shared by "remove from the active tenant" and "revoke access to tenant X".
 * The caller has already checked who may do this; the audit row lands in the tenant left.
 */
async function removeFromTenant(p: {
  tenant: TenantDb;
  clientId: string;
  user: UserRow;
  actorId: string;
  ip: string | null;
  requestId: string;
}): Promise<{ accountDeleted: boolean }> {
  const db = unsafeAcrossTenants();
  await p.tenant.delete(schema.groupUserMaps, eq(schema.groupUserMaps.user_id, p.user.id));
  await p.tenant.update(
    schema.clientUserMaps,
    { deleted_at: new Date() },
    eq(schema.clientUserMaps.user_id, p.user.id),
  );
  // Sessions pinned to this tenant lose it; the account survives while other tenants remain.
  await detachTenantFromSessions(db, p.clientId, p.user.id);
  const [remaining] = await db
    .select({ n: count() })
    .from(schema.clientUserMaps)
    .where(
      and(eq(schema.clientUserMaps.user_id, p.user.id), isNull(schema.clientUserMaps.deleted_at)),
    );
  const accountDeleted = Number(remaining?.n ?? 0) === 0;
  if (accountDeleted) {
    await db
      .update(schema.users)
      .set({ deleted_at: new Date() })
      .where(eq(schema.users.id, p.user.id));
    await invalidateUserSessions(p.user.id);
    await revokeAllSessions(db, p.user.id);
    emit('user.deleted', { userId: p.user.id, clientId: p.clientId }, { requestId: p.requestId });
  }
  await writeAudit(db, {
    clientId: p.clientId,
    actorId: p.actorId,
    action: 'user.delete',
    resource: 'user',
    resourceId: p.user.id,
    ip: p.ip,
    requestId: p.requestId,
    before: publicUser(p.user),
    after: { accountDeleted },
  });
  return { accountDeleted };
}

export const users = new Elysia({ name: 'users', prefix: '/users', tags: ['user'] })
  .use(requestContext)
  .use(tenantContext)

  // ---- own profile (D-4) — any session, no tenant needed ---------------------------------
  .get(
    '/profile/me',
    ({ auth, tenantState }) => {
      const a = actor(auth);
      return ok({ user: publicUser(a.user), clientId: tenantState?.clientId ?? null });
    },
    {
      beforeHandle: ({ auth, set, requestId }) => {
        if (auth) return;
        set.status = 401;
        return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', requestId);
      },
      response: {
        200: OkSchema(t.Object({ user: PublicUser, clientId: t.Nullable(t.String()) })),
        ...errorResponses,
      },
      detail: { summary: 'Get my profile' },
    },
  )
  .put(
    '/profile/me',
    async ({ auth, body, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants(); // users is a global table
      const patch: Partial<typeof schema.users.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.phone !== undefined) patch.phone = normalizePhone(body.phone);
      if (body.locale !== undefined) patch.locale = body.locale;
      if (body.theme !== undefined) patch.theme = body.theme;
      if (body.sidebarCollapsed !== undefined) patch.sidebar_collapsed = body.sidebarCollapsed;
      if (body.avatarUrl !== undefined) patch.avatar_url = body.avatarUrl;
      if (Object.keys(patch).length) {
        await db.update(schema.users).set(patch).where(eq(schema.users.id, a.user.id));
        await invalidateUserSessions(a.user.id);
      }
      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, a.user.id));
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.user.id,
        action: 'user.profile_edit',
        resource: 'user',
        resourceId: a.user.id,
        ip: clientIp(request, server),
        requestId,
        before: publicUser(a.user),
        after: publicUser(after as UserRow),
      });
      return ok({ user: publicUser(after as UserRow) });
    },
    {
      beforeHandle: ({ auth, set, requestId }) => {
        if (auth) return;
        set.status = 401;
        return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', requestId);
      },
      body: ProfileBody,
      response: { 200: OkSchema(t.Object({ user: PublicUser })), ...errorResponses },
      detail: {
        summary: 'Update my profile',
        description: 'Name, locale, theme, sidebar state and avatar.',
      },
    },
  )
  // ---- impersonation (D-6): acting as a user, with the account-menu mark + audit --------------
  .post(
    '/:id/impersonate',
    async ({ auth, params, set, request, server, requestId, cookie, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      /**
       * A superadmin reaches every account; anyone else only the members of the tenant they are
       * acting in — otherwise `user.impersonate` would be a way out of one's own tenant (B-3).
       */
      const target = a.user.is_superadmin
        ? (
            await db
              .select()
              .from(schema.users)
              .where(and(eq(schema.users.id, params.id), isNull(schema.users.deleted_at)))
              .limit(1)
          )[0]
        : await memberRow(tenantState?.tenant ?? null, params.id);
      if (!target) {
        set.status = 404;
        return fail('not_found', 'Pengguna tidak ditemukan', requestId);
      }
      if (target.id === a.user.id || target.is_superadmin) {
        set.status = 409;
        return fail(
          'conflict',
          'Tidak bisa berperan sebagai diri sendiri atau superadmin lain',
          requestId,
        );
      }
      if (target.status_id !== STATUS.ACTIVE) {
        set.status = 409;
        return fail('conflict', 'Pengguna nonaktif', requestId);
      }
      /**
       * The impersonated session is pinned to the tenant the admin is acting in — the target may
       * belong to tenants this admin cannot see. A superadmin has no active-tenant constraint, so
       * their session starts where the target's own would (D-6, unchanged).
       */
      const clientId = a.user.is_superadmin
        ? await defaultTenantOf(db, target.id)
        : (tenantState?.clientId ?? null);
      /**
       * C-5: impersonation must never hand out more than the caller already holds, or the
       * permission alone would be a ladder into the tenant's admin group. Compare the concrete
       * permissions each side ends up with — the registry is the closed list to expand against.
       */
      if (!a.user.is_superadmin) {
        const targetGrants = await effectivePermissions(db, target, clientId);
        const beyond = allPermissionStrings().find(
          (p) => hasPermission(targetGrants, p) && !tenantState?.can(p),
        );
        if (beyond) {
          set.status = 403;
          return fail('forbidden', 'Pengguna ini memegang izin yang tidak Anda miliki', requestId, {
            permission: beyond,
          });
        }
      }
      const ip = clientIp(request, server) ?? 'unknown';
      const session = await createSession(db, {
        userId: target.id,
        clientId,
        ip,
        userAgent: request.headers.get('user-agent'),
        ttlSeconds: IMPERSONATION_TTL_S,
        impersonatorId: a.user.id,
      });
      cookie[IMPERSONATE_COOKIE]?.set({
        value: session.token,
        ...cookieAttributes(request),
        expires: session.expiresAt,
      });
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.user.id,
        action: 'user.impersonate_start',
        resource: 'user',
        resourceId: target.id,
        ip,
        requestId,
        after: { sessionId: session.id, expiresAt: session.expiresAt.toISOString() },
      });
      return ok({ user: publicUser(target), expiresAt: session.expiresAt.toISOString() });
    },
    {
      beforeHandle: [notImpersonating, permission('user.impersonate')],
      params: t.Object({ id: Id }),
      response: {
        200: OkSchema(t.Object({ user: PublicUser, expiresAt: t.String() })),
        ...errorResponses,
      },
      detail: {
        summary: 'Impersonate a user',
        description:
          'Acts as this user for one hour through a second cookie; your own session is kept. Audited.',
      },
    },
  )
  .post(
    '/impersonate/stop',
    async ({ auth, set, request, server, requestId, cookie, tenantState }) => {
      const a = actor(auth);
      if (!a.impersonator || !a.session) {
        set.status = 409;
        return fail('conflict', 'Tidak sedang berperan sebagai pengguna lain', requestId);
      }
      const db = unsafeAcrossTenants();
      await revokeSession(db, a.session.id);
      cookie[IMPERSONATE_COOKIE]?.set({ value: '', ...cookieAttributes(request), maxAge: 0 });
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.impersonator.id,
        action: 'user.impersonate_stop',
        resource: 'user',
        resourceId: a.user.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({ stopped: true as const, user: publicUser(a.impersonator) });
    },
    {
      beforeHandle: sessionGuard,
      response: {
        200: OkSchema(t.Object({ stopped: t.Literal(true), user: PublicUser })),
        ...errorResponses,
      },
      detail: {
        summary: 'Stop impersonating',
        description: 'Revokes the impersonated session and returns to your own.',
      },
    },
  )

  // ---- 2FA TOTP (A-11): setup → enable (recovery codes shown once) → disable / regenerate -------
  .get(
    '/profile/mfa',
    async ({ auth }) => {
      const a = actor(auth);
      const [mfa] = await unsafeAcrossTenants()
        .select()
        .from(schema.userMfa)
        .where(eq(schema.userMfa.user_id, a.user.id))
        .limit(1);
      // While setup is pending the secret is the user's own, not yet enforced: returning it lets the
      // page keep showing the QR across reloads and failed attempts without rotating it.
      const pending = !!mfa && !mfa.enabled_at;
      const issuer = (await settings.get<string | null>(null, 'app.name')) || 'Dashboard';
      return ok({
        ...mfaStatus(mfa),
        secret: pending ? mfa.secret : null,
        otpauthUrl: pending ? otpauthUrl(issuer, a.user.email, mfa.secret) : null,
      });
    },
    {
      beforeHandle: sessionGuard,
      response: {
        200: OkSchema(
          t.Intersect([
            MfaStatus,
            t.Object({ secret: t.Nullable(t.String()), otpauthUrl: t.Nullable(t.String()) }),
          ]),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Get my 2FA status',
        description:
          'Whether 2FA is on, any pending setup (with its secret and otpauth URL), and recovery codes left.',
      },
    },
  )
  .post(
    '/profile/mfa/setup',
    async ({ auth }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const [existing] = await db
        .select()
        .from(schema.userMfa)
        .where(eq(schema.userMfa.user_id, a.user.id))
        .limit(1);
      if (existing?.enabled_at)
        return ok({ ...mfaStatus(existing), secret: null, otpauthUrl: null });
      const secret = generateTotpSecret();
      if (existing)
        await db
          .update(schema.userMfa)
          .set({ secret, last_step: null, recovery_codes: null })
          .where(eq(schema.userMfa.id, existing.id));
      else await db.insert(schema.userMfa).values({ id: newId(), user_id: a.user.id, secret });
      const issuer = (await settings.get<string | null>(null, 'app.name')) || 'Dashboard';
      return ok({
        enabled: false,
        pending: true,
        recoveryCodesLeft: 0,
        secret,
        otpauthUrl: otpauthUrl(issuer, a.user.email, secret),
      });
    },
    {
      beforeHandle: [sessionGuard, notImpersonating],
      response: {
        200: OkSchema(
          t.Intersect([
            MfaStatus,
            t.Object({ secret: t.Nullable(t.String()), otpauthUrl: t.Nullable(t.String()) }),
          ]),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Start 2FA setup',
        description:
          'Returns a new base32 secret and otpauth URL. Nothing is enforced until `/enable`.',
      },
    },
  )
  .post(
    '/profile/mfa/enable',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const [mfa] = await db
        .select()
        .from(schema.userMfa)
        .where(eq(schema.userMfa.user_id, a.user.id))
        .limit(1);
      if (!mfa) {
        set.status = 409;
        return fail('conflict', 'Mulai penyiapan dulu (POST /profile/mfa/setup)', requestId);
      }
      if (mfa.enabled_at) {
        set.status = 409;
        return fail('conflict', '2FA sudah aktif', requestId);
      }
      const step = await verifyTotp(mfa.secret, body.code);
      if (step === null) {
        set.status = 422;
        return fail('validation_failed', 'Kode dari aplikasi autentikator tidak cocok', requestId, {
          code: 'kode tidak cocok — periksa jam perangkat',
        });
      }
      const codes = generateRecoveryCodes();
      await db
        .update(schema.userMfa)
        .set({
          enabled_at: new Date(),
          last_step: step,
          recovery_codes: codes.map(hashRecoveryCode),
        })
        .where(eq(schema.userMfa.id, mfa.id));
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.user.id,
        action: 'user.mfa_enabled',
        resource: 'user',
        resourceId: a.user.id,
        ip: clientIp(request, server),
        requestId,
      });
      // Other devices must present the second factor from now on.
      await revokeAllSessions(db, a.user.id, a.session?.id);
      return ok({
        enabled: true,
        pending: false,
        recoveryCodesLeft: codes.length,
        recoveryCodes: codes,
      });
    },
    {
      beforeHandle: [sessionGuard, notImpersonating],
      body: MfaCodeBody,
      response: {
        200: OkSchema(t.Intersect([MfaStatus, t.Object({ recoveryCodes: t.Array(t.String()) })])),
        ...errorResponses,
      },
      detail: {
        summary: 'Enable 2FA',
        description: 'Confirms setup with a live code. Recovery codes are returned once.',
      },
    },
  )
  .post(
    '/profile/mfa/recovery-codes',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const [mfa] = await db
        .select()
        .from(schema.userMfa)
        .where(eq(schema.userMfa.user_id, a.user.id))
        .limit(1);
      if (!mfa?.enabled_at) {
        set.status = 409;
        return fail('conflict', '2FA belum aktif', requestId);
      }
      const step = await verifyTotp(mfa.secret, body.code, { lastStep: mfa.last_step });
      if (step === null) {
        set.status = 422;
        return fail('validation_failed', 'Kode tidak cocok', requestId, {
          code: 'kode tidak cocok',
        });
      }
      const codes = generateRecoveryCodes();
      await db
        .update(schema.userMfa)
        .set({ last_step: step, recovery_codes: codes.map(hashRecoveryCode) })
        .where(eq(schema.userMfa.id, mfa.id));
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.user.id,
        action: 'user.mfa_recovery_regenerated',
        resource: 'user',
        resourceId: a.user.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({
        enabled: true,
        pending: false,
        recoveryCodesLeft: codes.length,
        recoveryCodes: codes,
      });
    },
    {
      beforeHandle: [sessionGuard, notImpersonating],
      body: MfaCodeBody,
      response: {
        200: OkSchema(t.Intersect([MfaStatus, t.Object({ recoveryCodes: t.Array(t.String()) })])),
        ...errorResponses,
      },
      detail: {
        summary: 'Regenerate recovery codes',
        description: 'Needs a live TOTP code. The new codes are returned once.',
      },
    },
  )
  .post(
    '/profile/mfa/disable',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      if (!(await checkPassword(body.password, a.user.password_hash ?? null))) {
        set.status = 401;
        return fail('invalid_credentials', 'Kata sandi salah', requestId);
      }
      await db.delete(schema.userMfa).where(eq(schema.userMfa.user_id, a.user.id));
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.user.id,
        action: 'user.mfa_disabled',
        resource: 'user',
        resourceId: a.user.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({ enabled: false, pending: false, recoveryCodesLeft: 0 });
    },
    {
      beforeHandle: [sessionGuard, notImpersonating],
      body: MfaDisableBody,
      response: { 200: OkSchema(MfaStatus), ...errorResponses },
      detail: {
        summary: 'Disable 2FA',
        description: 'Needs the current password. Also discards a pending setup.',
      },
    },
  )

  // ---- avatar (Q-16): uploaded through the file service, public, user-global -----------------
  .put(
    '/profile/avatar',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const clientId = tenantState?.clientId ?? null;
      if (!clientId) {
        set.status = 409;
        return fail('conflict', 'Tidak ada tenant aktif', requestId);
      }
      const r = await storeUpload({
        clientId,
        userId: a.user.id,
        file: body.file,
        kind: 'avatar',
        visibility: 'public',
        // Avatars: images only, small — independent of the tenant's general upload allowlist.
        allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        maxBytes: AVATAR_MAX_BYTES,
      });
      if (!r.ok) {
        set.status = r.code === 'too_large' ? 413 : 422;
        return fail('validation_failed', r.message, requestId, { reason: r.code, file: r.message });
      }
      const db = unsafeAcrossTenants(); // users is a global table
      const previous = fileIdFromUrl(a.user.avatar_url);
      const url = `/v1/files/${r.row.id}/content`;
      await db.update(schema.users).set({ avatar_url: url }).where(eq(schema.users.id, a.user.id));
      await invalidateUserSessions(a.user.id);
      // The old uploaded avatar goes with it; an external URL is simply replaced.
      if (previous) {
        const old = await findAvatarFile(previous);
        if (old && old.user_id === a.user.id) await removeFile(old);
      }
      await writeAudit(db, {
        clientId,
        actorId: a.user.id,
        action: 'user.avatar_edit',
        resource: 'user',
        resourceId: a.user.id,
        ip: clientIp(request, server),
        requestId,
        before: { avatarUrl: a.user.avatar_url },
        after: { avatarUrl: url },
      });
      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, a.user.id));
      return ok({ user: publicUser(after as typeof a.user) });
    },
    {
      beforeHandle: ({ auth, set, requestId }) => {
        if (auth) return;
        set.status = 401;
        return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', requestId);
      },
      body: t.Object({ file: t.File() }),
      response: {
        200: OkSchema(t.Object({ user: PublicUser })),
        ...errorResponses,
        413: errorResponses[422],
      },
      detail: {
        summary: 'Upload my avatar',
        description:
          'Multipart `file`: PNG, JPEG, WebP or GIF up to 2 MB. Replaces the previous avatar.',
      },
    },
  )
  .delete(
    '/profile/avatar',
    async ({ auth, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const previous = fileIdFromUrl(a.user.avatar_url);
      await db.update(schema.users).set({ avatar_url: null }).where(eq(schema.users.id, a.user.id));
      await invalidateUserSessions(a.user.id);
      if (previous) {
        const old = await findAvatarFile(previous);
        if (old && old.user_id === a.user.id) await removeFile(old);
      }
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.user.id,
        action: 'user.avatar_edit',
        resource: 'user',
        resourceId: a.user.id,
        ip: clientIp(request, server),
        requestId,
        before: { avatarUrl: a.user.avatar_url },
        after: { avatarUrl: null },
      });
      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, a.user.id));
      return ok({ user: publicUser(after as typeof a.user) });
    },
    {
      beforeHandle: ({ auth, set, requestId }) => {
        if (auth) return;
        set.status = 401;
        return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', requestId);
      },
      response: { 200: OkSchema(t.Object({ user: PublicUser })), ...errorResponses },
      detail: { summary: 'Remove my avatar' },
    },
  )
  .delete(
    '/:id/mfa',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      // Lock-out recovery by an administrator (A-11): removes the user's second factor; audited.
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const [target] = await db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.id, params.id), isNull(schema.users.deleted_at)))
        .limit(1);
      if (!target) {
        set.status = 404;
        return fail('not_found', 'Pengguna tidak ditemukan', requestId);
      }
      await db.delete(schema.userMfa).where(eq(schema.userMfa.user_id, target.id));
      await revokeAllSessions(db, target.id);
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.user.id,
        action: 'user.mfa_reset_by_admin',
        resource: 'user',
        resourceId: target.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({ reset: true as const });
    },
    {
      beforeHandle: permission('user.edit'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ reset: t.Literal(true) })), ...errorResponses },
      detail: {
        summary: "Reset a user's 2FA",
        description: 'For lock-out recovery. Also ends their sessions.',
      },
    },
  )
  .put(
    '/:id/password',
    async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
      /**
       * An administrator sets a member's password (D-1) — the desk-side recovery when the person
       * cannot receive mail, or a shared account with no inbox. The rules of PUT /:id apply (member
       * of the active tenant, superadmins only by a superadmin) plus one of its own: never for
       * oneself, because the profile page asks for the current password first and this route does
       * not. Every session of the target ends: whoever held them was signed in with a password that
       * is no longer theirs.
       */
      const a = actor(auth);
      const ts = tenantOf(tenantState);
      const target = ts ? await memberRow(ts.tenant, params.id) : null;
      if (!ts || !target) return notFound(set, requestId, 'Pengguna');
      if (target.id === a.user.id) {
        return conflict(set, requestId, 'Ganti kata sandi Anda sendiri lewat halaman profil');
      }
      if (target.is_superadmin && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Superadmin hanya bisa diubah oleh superadmin', requestId);
      }
      const problems = passwordProblems(body.newPassword);
      if (problems.length) {
        set.status = 422;
        return fail('weak_password', 'Kata sandi baru terlalu lemah', requestId, problems);
      }
      const db = unsafeAcrossTenants(); // users is global (membership checked above)
      await db
        .update(schema.users)
        .set({ password_hash: await hashPassword(body.newPassword) })
        .where(eq(schema.users.id, target.id));
      // A reset link that is still in flight would let an older mail override what was just set.
      await db
        .update(schema.passwordResetTokens)
        .set({ used_at: new Date() })
        .where(
          and(
            eq(schema.passwordResetTokens.user_id, target.id),
            isNull(schema.passwordResetTokens.used_at),
          ),
        );
      await invalidateUserSessions(target.id);
      const revoked = await revokeAllSessions(db, target.id);
      await writeAudit(db, {
        clientId: ts.clientId,
        actorId: a.user.id,
        action: 'user.password_set_by_admin',
        resource: 'user',
        resourceId: target.id,
        ip: clientIp(request, server),
        requestId,
        after: { revokedSessions: revoked },
      });
      return ok({ changed: true as const, revokedSessions: revoked });
    },
    {
      beforeHandle: [notImpersonating, permission('user.edit')],
      params: t.Object({ id: Id }),
      body: AdminPasswordSetBody,
      response: {
        200: OkSchema(t.Object({ changed: t.Literal(true), revokedSessions: t.Integer() })),
        ...errorResponses,
      },
      detail: {
        summary: "Set a user's password",
        description: 'Not for your own account. Ends all their sessions. Audited.',
      },
    },
  )
  .post(
    '/:id/password/reset-link',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      /**
       * Mail a member the same link the "forgot password" page would (A-7), on their behalf. The
       * link lives 24 hours like the one a freshly created account gets — the admin is not the one
       * who will open it. An account that never had a password gets the "set" wording, one that has
       * a password gets "reset". The mail follows the RECIPIENT's saved language (K-2), the request's
       * only when they never chose one.
       */
      const a = actor(auth);
      const ts = tenantOf(tenantState);
      const target = ts ? await memberRow(ts.tenant, params.id) : null;
      if (!ts || !target) return notFound(set, requestId, 'Pengguna');
      if (target.is_superadmin && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Superadmin hanya bisa diubah oleh superadmin', requestId);
      }
      if (isUndeliverableEmail(target.email)) {
        // `.test` / `.invalid` never receive mail (RFC 2606): the link would only bounce.
        set.status = 422;
        return fail(
          'validation_failed',
          'Domain e-mail pengguna ini tidak bisa menerima surat',
          requestId,
          { reason: 'email_undeliverable', email: target.email },
        );
      }
      const db = unsafeAcrossTenants();
      const raw = randomToken();
      const expiresAt = new Date(Date.now() + ADMIN_RESET_LINK_TTL_MS);
      await db.insert(schema.passwordResetTokens).values({
        id: newId(),
        user_id: target.id,
        token_hash: hashToken(raw),
        expires_at: expiresAt,
      });
      const template = target.password_hash ? 'reset-password' : 'set-password';
      const locale =
        (target.locale === 'id' || target.locale === 'en' ? target.locale : null) ??
        (await mailLocale({ request, clientId: ts.clientId }));
      await sendTemplate(db, {
        to: target.email,
        toName: target.name,
        template,
        locale,
        clientId: ts.clientId,
        data: { name: target.name, link: publicLink(`/auth/reset?token=${raw}`, request) },
      });
      await writeAudit(db, {
        clientId: ts.clientId,
        actorId: a.user.id,
        action: 'user.password_reset_link',
        resource: 'user',
        resourceId: target.id,
        ip: clientIp(request, server),
        requestId,
        after: { template, expiresAt: expiresAt.toISOString() },
      });
      return ok({ sent: true as const, template, expiresAt: expiresAt.toISOString() });
    },
    {
      beforeHandle: [notImpersonating, permission('user.edit')],
      params: t.Object({ id: Id }),
      response: {
        200: OkSchema(
          t.Object({
            sent: t.Literal(true),
            template: t.Union([t.Literal('reset-password'), t.Literal('set-password')]),
            expiresAt: t.String(),
          }),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Send a password reset link',
        description:
          'The link is valid for 24 hours. Refused for `.test` and `.invalid` addresses.',
      },
    },
  )
  .put(
    '/profile/password',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      if (!(await checkPassword(body.currentPassword, a.user.password_hash))) {
        set.status = 401;
        return fail('invalid_credentials', 'Kata sandi saat ini salah', requestId);
      }
      const problems = passwordProblems(body.newPassword);
      if (problems.length) {
        set.status = 422;
        return fail('weak_password', 'Kata sandi baru terlalu lemah', requestId, problems);
      }
      await db
        .update(schema.users)
        .set({ password_hash: await hashPassword(body.newPassword) })
        .where(eq(schema.users.id, a.user.id));
      await invalidateUserSessions(a.user.id);
      // Other devices are signed out; this session stays (the user is clearly present here).
      const revoked = await revokeAllSessions(db, a.user.id, a.session?.id);
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.user.id,
        action: 'user.password_change',
        resource: 'user',
        resourceId: a.user.id,
        ip: clientIp(request, server),
        requestId,
        after: { revokedOtherSessions: revoked },
      });
      return ok({ changed: true as const, revokedOtherSessions: revoked });
    },
    {
      beforeHandle: [sessionGuard, notImpersonating],
      body: PasswordChangeBody,
      response: {
        200: OkSchema(t.Object({ changed: t.Literal(true), revokedOtherSessions: t.Integer() })),
        ...errorResponses,
      },
      detail: { summary: 'Change my password', description: 'Signs out your other sessions.' },
    },
  )

  // ---- tenant users (D-1) ------------------------------------------------------------------
  .get(
    '/',
    async ({ query, tenantState }) => {
      const ts = tenantOf(tenantState);
      const p = paging(query);
      if (!ts) return page([], p.meta(0));
      const db = unsafeAcrossTenants(); // join over users; tenant condition is explicit below
      const where = and(
        scopeOf(ts.tenant, schema.clientUserMaps),
        isNull(schema.clientUserMaps.deleted_at),
        isNull(schema.users.deleted_at),
        p.q
          ? or(
              sql`lower(${schema.users.email}) like ${likePattern(p.q)}`,
              sql`lower(${schema.users.name}) like ${likePattern(p.q)}`,
            )
          : undefined,
        // Group filter (D-1): members of that group in THIS tenant. An id from another tenant or a
        // deleted group simply matches nobody — the membership table is scoped, not the group id.
        query.group
          ? inArray(
              schema.users.id,
              db
                .select({ id: schema.groupUserMaps.user_id })
                .from(schema.groupUserMaps)
                .where(
                  and(
                    scopeOf(ts.tenant, schema.groupUserMaps),
                    eq(schema.groupUserMaps.group_id, query.group),
                  ),
                ),
            )
          : undefined,
        // Status filter: the account's own state (STATUS), not the membership's — the map is
        // already restricted to live rows above. Absent means "any".
        query.status !== undefined ? eq(schema.users.status_id, query.status) : undefined,
      );
      const base = () =>
        db
          .select({ user: schema.users })
          .from(schema.clientUserMaps)
          .innerJoin(schema.users, eq(schema.users.id, schema.clientUserMaps.user_id))
          .where(where);
      const [totalRow] = await db
        .select({ n: count() })
        .from(schema.clientUserMaps)
        .innerJoin(schema.users, eq(schema.users.id, schema.clientUserMaps.user_id))
        .where(where);
      const col = sortColumn(query.sort);
      const rows = await base()
        .orderBy(p.order === 'desc' ? desc(col) : asc(col))
        .limit(p.limit)
        .offset(p.offset);
      const presence = await presenceOf(rows.map((r) => r.user.id));
      const data = [];
      for (const r of rows) data.push(await tenantUser(ts.tenant, r.user, presence));
      return page(data, p.meta(Number(totalRow?.n ?? 0)));
    },
    {
      beforeHandle: permission('user.read'),
      query: UsersListQuery,
      response: { 200: PageSchema(TenantUser), ...errorResponses },
      detail: {
        summary: 'List users',
        description:
          'Users of the active tenant; paginated, searchable, sortable and filterable by group and status.',
      },
    },
  )
  .get(
    '/ip-info',
    async ({ query, set, requestId, tenantState }) => {
      const ts = tenantOf(tenantState);
      const ip = query.ip.trim();
      if (!ts || !isIpLiteral(ip)) return notFound(set, requestId, 'Alamat IP');
      // Only addresses this tenant's members were seen from: the endpoint is not a free
      // lookup service for anyone holding `user.read`.
      const db = unsafeAcrossTenants(); // join over users; tenant condition is explicit below
      const [seen] = await db
        .select({ id: schema.users.id })
        .from(schema.clientUserMaps)
        .innerJoin(schema.users, eq(schema.users.id, schema.clientUserMaps.user_id))
        .where(
          and(
            scopeOf(ts.tenant, schema.clientUserMaps),
            isNull(schema.clientUserMaps.deleted_at),
            isNull(schema.users.deleted_at),
            or(eq(schema.users.last_login_ip, ip), eq(schema.users.last_active_ip, ip)),
          ),
        )
        .limit(1);
      if (!seen) return notFound(set, requestId, 'Alamat IP');
      const found = await lookupIp(ip);
      if (!found.ok) {
        set.status = 503;
        return fail(
          'service_unavailable',
          found.reason === 'disabled'
            ? 'Pencarian lokasi IP dimatikan'
            : 'Layanan lokasi IP tidak menjawab',
          requestId,
          { reason: found.reason },
        );
      }
      return ok(found.info);
    },
    {
      beforeHandle: permission('user.read'),
      query: t.Object({ ip: t.String({ minLength: 1, maxLength: 45 }) }),
      response: { 200: OkSchema(IpInfoSchema), ...errorResponses },
      detail: {
        summary: 'Locate an IP address',
        description:
          'City, region, country and network of an address a member of the active tenant last ' +
          'logged in or was last active from. Private addresses are answered without an outside ' +
          'lookup; public ones go to the service configured by IP_LOOKUP_URL and are cached for a day.',
      },
    },
  )
  .get(
    '/:id',
    async ({ params, set, requestId, tenantState }) => {
      const ts = tenantOf(tenantState);
      const row = ts ? await memberRow(ts.tenant, params.id) : null;
      if (!ts || !row) return notFound(set, requestId, 'Pengguna');
      return ok(await tenantUser(ts.tenant, row, await presenceOf([row.id])));
    },
    {
      beforeHandle: permission('user.read'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(TenantUser), ...errorResponses },
      detail: { summary: 'Get a user' },
    },
  )
  .get(
    '/:id/tenants',
    async ({ auth, params, set, requestId, tenantState }) => {
      const a = actor(auth);
      const ts = tenantOf(tenantState);
      const row = ts ? await memberRow(ts.tenant, params.id) : null;
      if (!ts || !row) return notFound(set, requestId, 'Pengguna');
      // Only tenants the caller may act in are named; the switcher's own rule (B-4), reused.
      const mine = await tenantsOf(unsafeAcrossTenants(), a.user);
      const visible = new Set(mine.map((c) => c.id));
      const all = await membershipsOf(row.id);
      const memberships: (typeof TenantAccess.static)[] = [];
      for (const m of all) {
        if (!visible.has(m.id)) continue;
        const canRemove =
          row.id !== a.user.id &&
          (!row.is_superadmin || a.user.is_superadmin) &&
          (await canInTenant(a, m.id, 'user.manage'));
        memberships.push({
          id: m.id,
          code: m.code,
          name: m.name,
          isDefault: m.isDefault === true,
          canRemove,
        });
      }
      const has = new Set(all.map((m) => m.id));
      const candidates: (typeof TenantRef.static)[] = [];
      for (const c of mine) {
        if (has.has(c.id)) continue;
        if (await canInTenant(a, c.id, 'user.create'))
          candidates.push({ id: c.id, code: c.code, name: c.name });
      }
      return ok({ memberships, hidden: all.length - memberships.length, candidates });
    },
    {
      beforeHandle: permission('user.read'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(UserTenants), ...errorResponses },
      detail: {
        summary: "List a user's tenant access",
        description:
          'Which tenants this user (a member of the active tenant) may open, limited to tenants the caller may act in; `candidates` are the tenants the caller could add them to (`user.create` there).',
      },
    },
  )
  .post(
    '/:id/tenants',
    async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const ts = tenantOf(tenantState);
      const row = ts ? await memberRow(ts.tenant, params.id) : null;
      if (!ts || !row) return notFound(set, requestId, 'Pengguna');
      // The same bar as `POST /users` with a known address, but in the named tenant. A tenant the
      // caller cannot act in reads as "no such tenant" \u2014 never "exists, but not yours" (B-3).
      if (!(await canInTenant(a, body.clientId, 'user.create')))
        return notFound(set, requestId, 'Tenant');
      const db = unsafeAcrossTenants(); // the target tenant is not the active one by design
      if (await isMemberOf(db, row.id, body.clientId))
        return conflict(set, requestId, 'Pengguna sudah menjadi anggota tenant ini');
      const target = forTenant(body.clientId);
      // Membership: revive a soft-deleted row if there is one, else insert (unique per tenant+user).
      const old = await target.selectOne(
        schema.clientUserMaps,
        eq(schema.clientUserMaps.user_id, row.id),
      );
      if (old) {
        await target.update(
          schema.clientUserMaps,
          { deleted_at: null, is_default: false },
          eq(schema.clientUserMaps.id, old.id),
        );
      } else {
        await target.insert(schema.clientUserMaps, {
          id: newId(),
          user_id: row.id,
          is_default: false,
        });
      }
      // Land them in the tenant's Regular User group (as an invitation does), so the access is
      // usable at once; a tenant without that group leaves them without a group.
      const group = await target.selectOne(
        schema.groups,
        and(eq(schema.groups.code, DEFAULT_GROUP_CODE), isNull(schema.groups.deleted_at)),
      );
      if (group) {
        const has = await target.selectOne(
          schema.groupUserMaps,
          and(
            eq(schema.groupUserMaps.group_id, group.id),
            eq(schema.groupUserMaps.user_id, row.id),
          ),
        );
        if (!has)
          await target.insert(schema.groupUserMaps, {
            id: newId(),
            group_id: group.id,
            user_id: row.id,
          });
      }
      const [client] = await db
        .select({ id: schema.clients.id, code: schema.clients.code, name: schema.clients.name })
        .from(schema.clients)
        .where(eq(schema.clients.id, body.clientId))
        .limit(1);
      await writeAudit(db, {
        clientId: body.clientId,
        actorId: a.user.id,
        action: 'user.add_member',
        resource: 'user',
        resourceId: row.id,
        ip: clientIp(request, server),
        requestId,
        after: {
          email: row.email,
          groupIds: group ? [group.id] : [],
          ...(old ? { restored: true } : {}),
        },
      });
      set.status = 201;
      return ok({
        added: true as const,
        tenant: client as typeof TenantRef.static,
        group: group ? { id: group.id, code: group.code, name: group.name } : null,
      });
    },
    {
      beforeHandle: permission('user.read'),
      params: t.Object({ id: Id }),
      body: t.Object({ clientId: Id }),
      response: {
        201: OkSchema(
          t.Object({
            added: t.Literal(true),
            tenant: TenantRef,
            group: t.Nullable(t.Object({ id: t.String(), code: t.String(), name: t.String() })),
          }),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Give a user access to a tenant',
        description:
          "Adds this user (a member of the active tenant) to `clientId`, a tenant where the caller holds `user.create`; they join that tenant's Regular User group. A tenant the caller cannot act in is `not_found`, an existing membership `conflict`.",
      },
    },
  )
  .delete(
    '/:id/tenants/:clientId',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const ts = tenantOf(tenantState);
      const row = ts ? await memberRow(ts.tenant, params.id) : null;
      if (!ts || !row) return notFound(set, requestId, 'Pengguna');
      if (!(await canInTenant(a, params.clientId, 'user.manage')))
        return notFound(set, requestId, 'Tenant');
      if (row.id === a.user.id)
        return conflict(set, requestId, 'Anda tidak bisa menghapus diri sendiri');
      if (row.is_superadmin && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Superadmin hanya bisa dihapus oleh superadmin', requestId);
      }
      if (!(await isMemberOf(unsafeAcrossTenants(), row.id, params.clientId)))
        return notFound(set, requestId, 'Keanggotaan');
      const r = await removeFromTenant({
        tenant: forTenant(params.clientId),
        clientId: params.clientId,
        user: row,
        actorId: a.user.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({ deleted: true as const, ...r });
    },
    {
      beforeHandle: permission('user.read'),
      params: t.Object({ id: Id, clientId: Id }),
      response: {
        200: OkSchema(t.Object({ deleted: t.Literal(true), accountDeleted: t.Boolean() })),
        ...errorResponses,
      },
      detail: {
        summary: "Revoke a user's access to a tenant",
        description:
          'Removes this user (a member of the active tenant) from `clientId`, a tenant where the caller holds `user.manage` \u2014 the same step as removing them from the active tenant: groups there dropped, sessions detached, the account soft-deleted once no tenant remains.',
      },
    },
  )
  .post(
    '/',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const ts = tenantOf(tenantState);
      if (!ts) return conflict(set, requestId, 'Tidak ada tenant aktif');
      const db = unsafeAcrossTenants(); // users is global; membership goes through the facade
      const email = body.email.trim().toLowerCase();
      if (body.password !== undefined) {
        const problems = passwordProblems(body.password);
        if (problems.length) {
          set.status = 422;
          return fail('weak_password', 'Kata sandi terlalu lemah', requestId, problems);
        }
      }
      /**
       * Look past `deleted_at`: the UNIQUE on `email` covers soft-deleted rows too, so an account
       * whose last tenant removed it has to be REVIVED here. Inserting a second row with the same
       * e-mail fails in the database — an admin re-creating a user they had just removed used to
       * get a raw 500. Same rule as accepting an invitation (A-13).
       */
      let [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      let created = false;
      let restored = false;
      if (user && !user.deleted_at) {
        // An existing account: this is "add to my tenant", not a duplicate — unless already here.
        if (await isMemberOf(db, user.id, ts.clientId)) {
          return conflict(set, requestId, 'Pengguna sudah menjadi anggota tenant ini');
        }
      } else {
        const id = user?.id ?? newId();
        const values = {
          email,
          name: body.name.trim(),
          phone: normalizePhone(body.phone),
          password_hash: body.password ? await hashPassword(body.password) : null,
          locale: body.locale ?? null,
        };
        if (user) {
          // Nothing of the deleted account survives except its id and e-mail: it comes back with
          // the details typed now, active, and never as a superadmin.
          restored = true;
          await db
            .update(schema.users)
            .set({ ...values, status_id: STATUS.ACTIVE, is_superadmin: false, deleted_at: null })
            .where(eq(schema.users.id, id));
          await invalidateUserSessions(id);
        } else {
          await db.insert(schema.users).values({ id, ...values });
        }
        [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
        created = true;
        emit('user.created', { userId: id, clientId: ts.clientId }, { requestId });
        if (!body.password) {
          // No password given: the user sets one through the reset flow (A-7).
          const raw = randomToken();
          await db.insert(schema.passwordResetTokens).values({
            id: newId(),
            user_id: id,
            token_hash: hashToken(raw),
            expires_at: new Date(Date.now() + 24 * 3600_000),
          });
          await sendTemplate(db, {
            to: email,
            toName: body.name.trim(),
            template: 'set-password',
            locale: body.locale ?? (await mailLocale({ request, clientId: ts.clientId })),
            clientId: ts.clientId,
            data: { name: body.name.trim(), link: publicLink(`/auth/reset?token=${raw}`, request) },
          });
        }
      }
      const u = user as UserRow;
      // Membership: revive a soft-deleted row if there is one, else insert (unique per tenant+user).
      const old = await ts.tenant.selectOne(
        schema.clientUserMaps,
        eq(schema.clientUserMaps.user_id, u.id),
      );
      if (old) {
        await ts.tenant.update(
          schema.clientUserMaps,
          { deleted_at: null },
          eq(schema.clientUserMaps.id, old.id),
        );
      } else {
        await ts.tenant.insert(schema.clientUserMaps, {
          id: newId(),
          user_id: u.id,
          is_default: false,
        });
      }
      const problem = await setGroups(ts, u.id, body.groupIds ?? []);
      if (problem) {
        set.status = 422;
        return fail('validation_failed', problem, requestId);
      }
      await writeAudit(db, {
        clientId: ts.clientId,
        actorId: a.user.id,
        action: created ? 'user.create' : 'user.add_member',
        resource: 'user',
        resourceId: u.id,
        ip: clientIp(request, server),
        requestId,
        after: { email, groupIds: body.groupIds ?? [], ...(restored ? { restored } : {}) },
      });
      set.status = 201;
      return ok({ ...(await tenantUser(ts.tenant, u)), created });
    },
    {
      beforeHandle: permission('user.create'),
      body: UserCreateBody,
      response: {
        201: OkSchema(t.Intersect([TenantUser, t.Object({ created: t.Boolean() })])),
        ...errorResponses,
      },
      detail: {
        summary: 'Create a user',
        description: 'Creates the account, or adds an existing account to the active tenant.',
      },
    },
  )
  .put(
    '/:id',
    async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const ts = tenantOf(tenantState);
      const before = ts ? await memberRow(ts.tenant, params.id) : null;
      if (!ts || !before) return notFound(set, requestId, 'Pengguna');
      if (body.isSuperadmin !== undefined && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Hanya superadmin yang boleh mengubah flag superadmin', requestId);
      }
      if (before.id === a.user.id && (body.isSuperadmin === false || body.statusId === 0)) {
        return conflict(set, requestId, 'Anda tidak bisa menonaktifkan diri sendiri');
      }
      if (before.is_superadmin && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Superadmin hanya bisa diubah oleh superadmin', requestId);
      }
      const db = unsafeAcrossTenants(); // users is global (membership checked above)
      const patch: Partial<typeof schema.users.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.phone !== undefined) patch.phone = normalizePhone(body.phone);
      if (body.locale !== undefined) patch.locale = body.locale;
      if (body.statusId !== undefined) patch.status_id = body.statusId;
      if (body.isSuperadmin !== undefined) patch.is_superadmin = body.isSuperadmin;
      if (Object.keys(patch).length) {
        await db.update(schema.users).set(patch).where(eq(schema.users.id, before.id));
        await invalidateUserSessions(before.id);
      }
      if (body.statusId === STATUS.INACTIVE) await revokeAllSessions(db, before.id);
      const beforeGroups = await groupsOf(ts.tenant, before.id);
      if (body.groupIds) {
        const problem = await setGroups(ts, before.id, body.groupIds);
        if (problem) {
          set.status = 422;
          return fail('validation_failed', problem, requestId);
        }
      }
      const after = (await memberRow(ts.tenant, before.id)) as UserRow;
      const result = await tenantUser(ts.tenant, after);
      await writeAudit(db, {
        clientId: ts.clientId,
        actorId: a.user.id,
        action: 'user.edit',
        resource: 'user',
        resourceId: before.id,
        ip: clientIp(request, server),
        requestId,
        before: { ...publicUser(before), statusId: before.status_id, groups: beforeGroups },
        after: result,
      });
      return ok(result);
    },
    {
      beforeHandle: permission('user.edit'),
      params: t.Object({ id: Id }),
      body: UserUpdateBody,
      response: { 200: OkSchema(TenantUser), ...errorResponses },
      detail: {
        summary: 'Update a user',
        description: '`groupIds` replaces their groups in the active tenant.',
      },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const ts = tenantOf(tenantState);
      const row = ts ? await memberRow(ts.tenant, params.id) : null;
      if (!ts || !row) return notFound(set, requestId, 'Pengguna');
      if (row.id === a.user.id)
        return conflict(set, requestId, 'Anda tidak bisa menghapus diri sendiri');
      if (row.is_superadmin && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Superadmin hanya bisa dihapus oleh superadmin', requestId);
      }
      const r = await removeFromTenant({
        tenant: ts.tenant,
        clientId: ts.clientId,
        user: row,
        actorId: a.user.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({ deleted: true as const, ...r });
    },
    {
      beforeHandle: permission('user.manage'),
      params: t.Object({ id: Id }),
      response: {
        200: OkSchema(t.Object({ deleted: t.Literal(true), accountDeleted: t.Boolean() })),
        ...errorResponses,
      },
      detail: {
        summary: 'Remove a user',
        description:
          'Soft-removes them from the active tenant; the account is deleted once no tenant remains.',
      },
    },
  );
