import {
  detachTenantFromSessions,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hashRecoveryCode,
  hashToken,
  invalidateUserSessions,
  isMemberOf,
  otpauthUrl,
  passwordProblems,
  randomToken,
  revokeAllSessions,
  verifyPassword,
  verifyTotp,
  writeAudit,
} from '@core/auth';
import {
  errorResponses,
  fail,
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
  inArray,
  isNull,
  newId,
  or,
  STATUS,
  schema,
  sql,
  unsafeAcrossTenants,
} from '@core/db';
import { Elysia, t } from 'elysia';
import { fileIdFromUrl, findAvatarFile, removeFile, storeUpload } from '../files.ts';
import { conflict, Id, ListQuery, likePattern, notFound, paging, scopeOf } from '../lib/http.ts';
import { publicLink, sendTemplate } from '../mail.ts';
import { type AuthState, clientIp, publicUser } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, type TenantState, tenantContext } from '../plugins/tenancy.ts';
import { emit, settings } from '../services.ts';

/** Avatars are small by construction: 2 MB caps even a generous PNG. */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

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
} as const;
const sortColumn = (key: string | undefined) =>
  key && key in SORT ? SORT[key as keyof typeof SORT] : SORT.name;

const PublicUser = t.Object({
  id: t.String(),
  email: t.String(),
  name: t.String(),
  avatarUrl: t.Nullable(t.String()),
  locale: t.String(),
  theme: t.Nullable(t.String()),
  isSuperadmin: t.Boolean(),
  emailVerifiedAt: t.Nullable(t.String()),
  lastLoginAt: t.Nullable(t.String()),
  createdAt: t.String(),
});
const TenantUser = t.Intersect([
  PublicUser,
  t.Object({
    statusId: t.Integer(),
    groups: t.Array(t.Object({ id: t.String(), code: t.String(), name: t.String() })),
  }),
]);

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

async function tenantUser(tenant: TenantState['tenant'], u: UserRow) {
  return { ...publicUser(u), statusId: u.status_id, groups: await groupsOf(tenant, u.id) };
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
      detail: { summary: 'My profile' },
    },
  )
  .put(
    '/profile/me',
    async ({ auth, body, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants(); // users is a global table
      const patch: Partial<typeof schema.users.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.locale !== undefined) patch.locale = body.locale;
      if (body.theme !== undefined) patch.theme = body.theme;
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
      detail: { summary: 'Edit my profile: name, locale, theme, avatar (D-4)' },
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
        summary:
          'My 2FA status: enabled, pending setup (with its secret + otpauth URL), recovery codes left',
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
        summary:
          'Start 2FA setup: a new secret (base32) + otpauth URL; nothing is enforced until /enable',
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
      beforeHandle: sessionGuard,
      body: MfaCodeBody,
      response: {
        200: OkSchema(t.Intersect([MfaStatus, t.Object({ recoveryCodes: t.Array(t.String()) })])),
        ...errorResponses,
      },
      detail: {
        summary:
          'Confirm setup with a live code: 2FA becomes mandatory for my logins; recovery codes returned once',
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
      beforeHandle: sessionGuard,
      body: MfaCodeBody,
      response: {
        200: OkSchema(t.Intersect([MfaStatus, t.Object({ recoveryCodes: t.Array(t.String()) })])),
        ...errorResponses,
      },
      detail: { summary: 'Replace all recovery codes (needs a live TOTP code); returned once' },
    },
  )
  .post(
    '/profile/mfa/disable',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      if (!(await verifyPassword(body.password, a.user.password_hash ?? null))) {
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
      beforeHandle: sessionGuard,
      body: MfaDisableBody,
      response: { 200: OkSchema(MfaStatus), ...errorResponses },
      detail: {
        summary: 'Turn 2FA off (current password required); also discards a pending setup',
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
        summary:
          'Upload my avatar (multipart `file`, PNG/JPEG/WebP/GIF ≤ 2 MB); replaces the previous one',
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
      detail: { summary: 'Remove my avatar (the uploaded file is deleted too)' },
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
      detail: { summary: 'Admin: remove a user’s 2FA (lock-out recovery) and end their sessions' },
    },
  )
  .put(
    '/profile/password',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      if (!(await verifyPassword(body.currentPassword, a.user.password_hash))) {
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
      beforeHandle: ({ auth, set, requestId }) => {
        if (auth) return;
        set.status = 401;
        return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', requestId);
      },
      body: PasswordChangeBody,
      response: {
        200: OkSchema(t.Object({ changed: t.Literal(true), revokedOtherSessions: t.Integer() })),
        ...errorResponses,
      },
      detail: { summary: 'Change my password; signs out my other sessions (D-4)' },
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
      const data = [];
      for (const r of rows) data.push(await tenantUser(ts.tenant, r.user));
      return page(data, p.meta(Number(totalRow?.n ?? 0)));
    },
    {
      beforeHandle: permission('user.read'),
      query: ListQuery,
      response: { 200: PageSchema(TenantUser), ...errorResponses },
      detail: { summary: 'Users of the active tenant: paginated, searchable, sortable (D-1)' },
    },
  )
  .get(
    '/:id',
    async ({ params, set, requestId, tenantState }) => {
      const ts = tenantOf(tenantState);
      const row = ts ? await memberRow(ts.tenant, params.id) : null;
      if (!ts || !row) return notFound(set, requestId, 'Pengguna');
      return ok(await tenantUser(ts.tenant, row));
    },
    {
      beforeHandle: permission('user.read'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(TenantUser), ...errorResponses },
      detail: { summary: 'One user of the active tenant, with their groups' },
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
      let [user] = await db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.email, email), isNull(schema.users.deleted_at)))
        .limit(1);
      let created = false;
      if (user) {
        // An existing account: this is "add to my tenant", not a duplicate — unless already here.
        if (await isMemberOf(db, user.id, ts.clientId)) {
          return conflict(set, requestId, 'Pengguna sudah menjadi anggota tenant ini');
        }
      } else {
        const id = newId();
        await db.insert(schema.users).values({
          id,
          email,
          name: body.name.trim(),
          password_hash: body.password ? await hashPassword(body.password) : null,
          locale: body.locale ?? 'id',
        });
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
            locale: body.locale ?? 'id',
            clientId: ts.clientId,
            data: { name: body.name.trim(), link: publicLink(`/auth/reset?token=${raw}`) },
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
        after: { email, groupIds: body.groupIds ?? [] },
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
        summary:
          'Create a user in the active tenant, or add an existing account to it; optional groups',
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
      detail: { summary: 'Edit a user of the active tenant; groupIds replaces their groups here' },
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
      const db = unsafeAcrossTenants();
      await ts.tenant.delete(schema.groupUserMaps, eq(schema.groupUserMaps.user_id, row.id));
      await ts.tenant.update(
        schema.clientUserMaps,
        { deleted_at: new Date() },
        eq(schema.clientUserMaps.user_id, row.id),
      );
      // Sessions pinned to this tenant lose it; the account survives while other tenants remain.
      await detachTenantFromSessions(db, ts.clientId, row.id);
      const [remaining] = await db
        .select({ n: count() })
        .from(schema.clientUserMaps)
        .where(
          and(eq(schema.clientUserMaps.user_id, row.id), isNull(schema.clientUserMaps.deleted_at)),
        );
      const accountDeleted = Number(remaining?.n ?? 0) === 0;
      if (accountDeleted) {
        await db
          .update(schema.users)
          .set({ deleted_at: new Date() })
          .where(eq(schema.users.id, row.id));
        await invalidateUserSessions(row.id);
        await revokeAllSessions(db, row.id);
        emit('user.deleted', { userId: row.id, clientId: ts.clientId }, { requestId });
      }
      await writeAudit(db, {
        clientId: ts.clientId,
        actorId: a.user.id,
        action: 'user.delete',
        resource: 'user',
        resourceId: row.id,
        ip: clientIp(request, server),
        requestId,
        before: publicUser(row),
        after: { accountDeleted },
      });
      return ok({ deleted: true as const, accountDeleted });
    },
    {
      beforeHandle: permission('user.manage'),
      params: t.Object({ id: Id }),
      response: {
        200: OkSchema(t.Object({ deleted: t.Literal(true), accountDeleted: t.Boolean() })),
        ...errorResponses,
      },
      detail: {
        summary:
          'Remove a user from the active tenant (soft); the account goes when no tenant remains',
      },
    },
  );
