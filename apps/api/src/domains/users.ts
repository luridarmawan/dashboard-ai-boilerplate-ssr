import {
  hashPassword,
  hashToken,
  isMemberOf,
  passwordProblems,
  randomToken,
  revokeAllSessions,
  verifyPassword,
  writeAudit,
} from '@core/auth';
import {
  errorResponses,
  fail,
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
import { conflict, Id, ListQuery, likePattern, notFound, paging, scopeOf } from '../lib/http.ts';
import { publicLink, sendTemplate } from '../mail.ts';
import { type AuthState, clientIp, publicUser } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, type TenantState, tenantContext } from '../plugins/tenancy.ts';
import { emit } from '../services.ts';

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
      // Other devices are signed out; this session stays (the user is clearly present here).
      const revoked = await revokeAllSessions(db, a.user.id, a.session.id);
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
      await db
        .update(schema.sessions)
        .set({ client_id: null })
        .where(
          and(eq(schema.sessions.user_id, row.id), eq(schema.sessions.client_id, ts.clientId)),
        );
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
