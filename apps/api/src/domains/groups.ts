import {
  isMemberOf,
  isRegistered,
  isValidPermission,
  normalizeGrants,
  writeAudit,
} from '@core/auth';
import {
  errorResponses,
  fail,
  GroupCreateBody,
  GroupPermissionsBody,
  GroupUpdateBody,
  OkSchema,
  ok,
  PageMetaSchema,
  PageSchema,
  page,
} from '@core/contracts';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  newId,
  schema,
  sql,
  unsafeAcrossTenants,
} from '@core/db';
import { Elysia, t } from 'elysia';
import { conflict, Id, ListQuery, likePattern, notFound, paging, scopeOf } from '../lib/http.ts';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, type TenantState, tenantContext } from '../plugins/tenancy.ts';

/**
 * Groups of the ACTIVE tenant, their permissions and their members (PRD C-3, C-4, D-2).
 * Three route families as in Appendix A: `/groups`, `/group-permissions`, `/group-members`.
 * Path parameters are all `:id` on purpose: the typed client (Eden) needs one name per segment.
 *
 * Every read goes through the tenant facade; a group id from another tenant is "not found".
 * Permission strings written here must be a wildcard or exist in the registry (C-4) — the
 * editor's dropdown and this validation are the same list. System groups (`is_system`) keep
 * their code and cannot be deleted; their name and permissions may change.
 */

const Group = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  description: t.Nullable(t.String()),
  isSystem: t.Boolean(),
  permissionCount: t.Integer(),
  memberCount: t.Integer(),
  createdAt: t.String(),
});
const Permission = t.Object({ id: t.String(), permission: t.String() });
const Member = t.Object({
  id: t.String(),
  userId: t.String(),
  email: t.String(),
  name: t.String(),
});

type GroupRow = typeof schema.groups.$inferSelect;

function actor(auth: AuthState | null): AuthState {
  if (!auth) throw new Error('guard missing: route reached without a session');
  return auth;
}
function tenantOf(ts: TenantState | undefined) {
  if (!ts?.tenant || !ts.clientId) return null;
  return { tenant: ts.tenant, clientId: ts.clientId };
}
type Scope = NonNullable<ReturnType<typeof tenantOf>>;

async function liveGroup(ts: Scope, id: string): Promise<GroupRow | null> {
  return ts.tenant.selectOne(
    schema.groups,
    and(eq(schema.groups.id, id), isNull(schema.groups.deleted_at)),
  );
}

async function counts(ts: Scope, groupIds: string[]) {
  const out = new Map<string, { permissions: number; members: number }>();
  if (!groupIds.length) return out;
  const db = unsafeAcrossTenants(); // aggregates; tenant condition is explicit below
  const perms = await db
    .select({ groupId: schema.groupPermissions.group_id, n: count() })
    .from(schema.groupPermissions)
    .where(
      and(
        scopeOf(ts.tenant, schema.groupPermissions),
        inArray(schema.groupPermissions.group_id, groupIds),
      ),
    )
    .groupBy(schema.groupPermissions.group_id);
  const members = await db
    .select({ groupId: schema.groupUserMaps.group_id, n: count() })
    .from(schema.groupUserMaps)
    .where(
      and(
        scopeOf(ts.tenant, schema.groupUserMaps),
        inArray(schema.groupUserMaps.group_id, groupIds),
      ),
    )
    .groupBy(schema.groupUserMaps.group_id);
  for (const id of groupIds) out.set(id, { permissions: 0, members: 0 });
  for (const r of perms)
    out.set(r.groupId, {
      ...(out.get(r.groupId) ?? { members: 0 }),
      permissions: Number(r.n),
    } as never);
  for (const r of members)
    out.set(r.groupId, {
      ...(out.get(r.groupId) ?? { permissions: 0 }),
      members: Number(r.n),
    } as never);
  return out;
}

function view(g: GroupRow, c: { permissions: number; members: number }) {
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    description: g.description,
    isSystem: g.is_system,
    permissionCount: c.permissions,
    memberCount: c.members,
    createdAt: g.created_at.toISOString(),
  };
}

/** Reject what the registry does not know (C-4). Returns the offending strings. */
export function unknownPermissions(list: string[]): string[] {
  return list.filter((p) => !isValidPermission(p) || (!p.includes('*') && !isRegistered(p)));
}

async function permissionsOf(ts: Scope, groupId: string) {
  const rows = await ts.tenant.select(
    schema.groupPermissions,
    eq(schema.groupPermissions.group_id, groupId),
  );
  return rows
    .map((r) => ({ id: r.id, permission: r.permission }))
    .sort((a, b) => a.permission.localeCompare(b.permission));
}

/**
 * Members of one group. A tenant can hold thousands of users and a seeded group tends to hold
 * most of them, so the page a browser asks for is SEARCHED and PAGED: handing back every row
 * made one page render grow with the tenant. `opts` omitted = every row, which only the delete
 * path (one admin action, and it needs the full id list for its audit entry) still asks for.
 */
async function membersOf(
  ts: Scope,
  groupId: string,
  opts?: { limit: number; offset: number; q: string | null },
) {
  const db = unsafeAcrossTenants(); // join; tenant condition is explicit below
  const where = and(
    scopeOf(ts.tenant, schema.groupUserMaps),
    eq(schema.groupUserMaps.group_id, groupId),
    isNull(schema.users.deleted_at),
    opts?.q
      ? sql`(lower(${schema.users.name}) like ${likePattern(opts.q)} or lower(${schema.users.email}) like ${likePattern(opts.q)})`
      : undefined,
  );
  const q = db
    .select({
      id: schema.groupUserMaps.id,
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.groupUserMaps)
    .innerJoin(schema.users, eq(schema.users.id, schema.groupUserMaps.user_id))
    .where(where)
    .orderBy(asc(schema.users.name));
  const rows = opts ? await q.limit(opts.limit).offset(opts.offset) : await q;
  if (!opts) return { rows, total: rows.length };
  const [c] = await db
    .select({ n: count() })
    .from(schema.groupUserMaps)
    .innerJoin(schema.users, eq(schema.users.id, schema.groupUserMaps.user_id))
    .where(where);
  return { rows, total: Number(c?.n ?? 0) };
}

export const groups = new Elysia({ name: 'groups', tags: ['groups'] })
  .use(requestContext)
  .use(tenantContext)
  .group('/groups', (r) =>
    r
      .get(
        '/',
        async ({ query, tenantState }) => {
          const ts = tenantOf(tenantState);
          const p = paging(query);
          if (!ts) return page([], p.meta(0));
          const where = and(
            isNull(schema.groups.deleted_at),
            p.q
              ? sql`(lower(${schema.groups.name}) like ${likePattern(p.q)} or lower(${schema.groups.code}) like ${likePattern(p.q)})`
              : undefined,
          );
          const all = await ts.tenant.select(schema.groups, where);
          const col =
            query.sort === 'code' ? 'code' : query.sort === 'created_at' ? 'created_at' : 'name';
          const sorted = [...all].sort((a, b) => {
            const av = a[col] instanceof Date ? (a[col] as Date).getTime() : String(a[col]);
            const bv = b[col] instanceof Date ? (b[col] as Date).getTime() : String(b[col]);
            const c = av < bv ? -1 : av > bv ? 1 : 0;
            return p.order === 'desc' ? -c : c;
          });
          const pageRows = sorted.slice(p.offset, p.offset + p.limit);
          const c = await counts(
            ts,
            pageRows.map((g) => g.id),
          );
          return page(
            pageRows.map((g) => view(g, c.get(g.id) ?? { permissions: 0, members: 0 })),
            p.meta(all.length),
          );
        },
        {
          beforeHandle: permission('group.read'),
          query: ListQuery,
          response: { 200: PageSchema(Group), ...errorResponses },
          detail: { summary: 'Groups of the active tenant with permission/member counts (D-2)' },
        },
      )
      .get(
        '/:id',
        async ({ params, query, set, requestId, tenantState }) => {
          const ts = tenantOf(tenantState);
          const g = ts ? await liveGroup(ts, params.id) : null;
          if (!ts || !g) return notFound(set, requestId, 'Grup');
          const c = await counts(ts, [g.id]);
          // `members` is ONE page (`?page`, `?limit`, `?q`), never the whole roster: a seeded
          // group holds most of the tenant, so the old full array made this response — and the
          // page rendering it — grow with the tenant. `memberPage` says what the caller is
          // looking at; `memberCount` above stays the unfiltered total.
          const p = paging(query, 25);
          const m = await membersOf(ts, g.id, { limit: p.limit, offset: p.offset, q: p.q });
          return ok({
            ...view(g, c.get(g.id) ?? { permissions: 0, members: 0 }),
            permissions: await permissionsOf(ts, g.id),
            members: m.rows,
            memberPage: p.meta(m.total),
          });
        },
        {
          beforeHandle: permission('group.read'),
          params: t.Object({ id: Id }),
          query: ListQuery,
          response: {
            200: OkSchema(
              t.Intersect([
                Group,
                t.Object({
                  permissions: t.Array(Permission),
                  members: t.Array(Member),
                  memberPage: PageMetaSchema,
                }),
              ]),
            ),
            ...errorResponses,
          },
          detail: { summary: 'One group with its permissions and one page of its members' },
        },
      )
      .post(
        '/',
        async ({ auth, body, set, request, server, requestId, tenantState }) => {
          const a = actor(auth);
          const ts = tenantOf(tenantState);
          if (!ts) return conflict(set, requestId, 'Tidak ada tenant aktif');
          const dup = await ts.tenant.selectOne(schema.groups, eq(schema.groups.code, body.code));
          if (dup) return conflict(set, requestId, `Kode grup "${body.code}" sudah dipakai`);
          const bad = unknownPermissions(body.permissions ?? []);
          if (bad.length) {
            set.status = 422;
            return fail(
              'validation_failed',
              'Ada izin yang tidak dikenal registry (C-4)',
              requestId,
              { unknown: bad },
            );
          }
          const id = newId();
          await ts.tenant.insert(schema.groups, {
            id,
            code: body.code,
            name: body.name.trim(),
            description: body.description ?? null,
            is_system: false,
          });
          const perms = normalizeGrants(body.permissions ?? []);
          if (perms.length) {
            await ts.tenant.insert(
              schema.groupPermissions,
              perms.map((permission) => ({ id: newId(), group_id: id, permission })),
            );
          }
          const g = (await liveGroup(ts, id)) as GroupRow;
          const result = view(g, { permissions: perms.length, members: 0 });
          await writeAudit(unsafeAcrossTenants(), {
            clientId: ts.clientId,
            actorId: a.user.id,
            action: 'group.create',
            resource: 'group',
            resourceId: id,
            ip: clientIp(request, server),
            requestId,
            after: { ...result, permissions: perms },
          });
          set.status = 201;
          return ok(result);
        },
        {
          beforeHandle: permission('group.create'),
          body: GroupCreateBody,
          response: { 201: OkSchema(Group), ...errorResponses },
          detail: { summary: 'Create a group in the active tenant, optionally with permissions' },
        },
      )
      .put(
        '/:id',
        async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
          const a = actor(auth);
          const ts = tenantOf(tenantState);
          const before = ts ? await liveGroup(ts, params.id) : null;
          if (!ts || !before) return notFound(set, requestId, 'Grup');
          if (body.code !== undefined && body.code !== before.code) {
            if (before.is_system)
              return conflict(set, requestId, 'Kode grup sistem tidak bisa diubah');
            const dup = await ts.tenant.selectOne(schema.groups, eq(schema.groups.code, body.code));
            if (dup) return conflict(set, requestId, `Kode grup "${body.code}" sudah dipakai`);
          }
          const patch: Partial<typeof schema.groups.$inferInsert> = {};
          if (body.code !== undefined) patch.code = body.code;
          if (body.name !== undefined) patch.name = body.name.trim();
          if (body.description !== undefined) patch.description = body.description;
          if (Object.keys(patch).length) {
            await ts.tenant.update(schema.groups, patch, eq(schema.groups.id, before.id));
          }
          const after = (await liveGroup(ts, before.id)) as GroupRow;
          const c = await counts(ts, [after.id]);
          const result = view(after, c.get(after.id) ?? { permissions: 0, members: 0 });
          await writeAudit(unsafeAcrossTenants(), {
            clientId: ts.clientId,
            actorId: a.user.id,
            action: 'group.edit',
            resource: 'group',
            resourceId: before.id,
            ip: clientIp(request, server),
            requestId,
            before: { code: before.code, name: before.name, description: before.description },
            after: { code: after.code, name: after.name, description: after.description },
          });
          return ok(result);
        },
        {
          beforeHandle: permission('group.edit'),
          params: t.Object({ id: Id }),
          body: GroupUpdateBody,
          response: { 200: OkSchema(Group), ...errorResponses },
          detail: { summary: 'Rename / describe a group (system groups keep their code)' },
        },
      )
      .delete(
        '/:id',
        async ({ auth, params, set, request, server, requestId, tenantState }) => {
          const a = actor(auth);
          const ts = tenantOf(tenantState);
          const g = ts ? await liveGroup(ts, params.id) : null;
          if (!ts || !g) return notFound(set, requestId, 'Grup');
          if (g.is_system) return conflict(set, requestId, 'Grup sistem tidak bisa dihapus');
          const perms = await permissionsOf(ts, g.id);
          const members = (await membersOf(ts, g.id)).rows;
          await ts.tenant.delete(schema.groupUserMaps, eq(schema.groupUserMaps.group_id, g.id));
          await ts.tenant.delete(
            schema.groupPermissions,
            eq(schema.groupPermissions.group_id, g.id),
          );
          await ts.tenant.update(
            schema.groups,
            { deleted_at: new Date() },
            eq(schema.groups.id, g.id),
          );
          await writeAudit(unsafeAcrossTenants(), {
            clientId: ts.clientId,
            actorId: a.user.id,
            action: 'group.delete',
            resource: 'group',
            resourceId: g.id,
            ip: clientIp(request, server),
            requestId,
            before: {
              code: g.code,
              name: g.name,
              permissions: perms.map((p) => p.permission),
              members: members.map((m) => m.userId),
            },
          });
          return ok({ deleted: true as const });
        },
        {
          beforeHandle: permission('group.manage'),
          params: t.Object({ id: Id }),
          response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
          detail: {
            summary: 'Soft-delete a non-system group; members lose its permissions at once',
          },
        },
      ),
  )

  // ---- group-permissions (C-3, C-4) ------------------------------------------------------
  .group('/group-permissions', (r) =>
    r
      .get(
        '/:id',
        async ({ params, set, requestId, tenantState }) => {
          const ts = tenantOf(tenantState);
          const g = ts ? await liveGroup(ts, params.id) : null;
          if (!ts || !g) return notFound(set, requestId, 'Grup');
          return ok({ groupId: g.id, permissions: await permissionsOf(ts, g.id) });
        },
        {
          beforeHandle: permission('group.read'),
          params: t.Object({ id: Id }),
          response: {
            200: OkSchema(t.Object({ groupId: t.String(), permissions: t.Array(Permission) })),
            ...errorResponses,
          },
          detail: { summary: 'Permissions of a group' },
        },
      )
      .put(
        '/:id',
        async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
          const a = actor(auth);
          const ts = tenantOf(tenantState);
          const g = ts ? await liveGroup(ts, params.id) : null;
          if (!ts || !g) return notFound(set, requestId, 'Grup');
          const bad = unknownPermissions(body.permissions);
          if (bad.length) {
            set.status = 422;
            return fail(
              'validation_failed',
              'Ada izin yang tidak dikenal registry (C-4)',
              requestId,
              { unknown: bad },
            );
          }
          const before = (await permissionsOf(ts, g.id)).map((p) => p.permission);
          const next = normalizeGrants(body.permissions);
          await ts.tenant.delete(
            schema.groupPermissions,
            eq(schema.groupPermissions.group_id, g.id),
          );
          if (next.length) {
            await ts.tenant.insert(
              schema.groupPermissions,
              next.map((permission) => ({ id: newId(), group_id: g.id, permission })),
            );
          }
          await writeAudit(unsafeAcrossTenants(), {
            clientId: ts.clientId,
            actorId: a.user.id,
            action: 'group.permissions_set',
            resource: 'group',
            resourceId: g.id,
            ip: clientIp(request, server),
            requestId,
            before: { permissions: before },
            after: { permissions: next },
          });
          return ok({ groupId: g.id, permissions: await permissionsOf(ts, g.id) });
        },
        {
          beforeHandle: permission('group.edit'),
          params: t.Object({ id: Id }),
          body: GroupPermissionsBody,
          response: {
            200: OkSchema(t.Object({ groupId: t.String(), permissions: t.Array(Permission) })),
            ...errorResponses,
          },
          detail: {
            summary: 'Replace the whole permission set of a group (validated against the registry)',
          },
        },
      )
      .post(
        '/',
        async ({ auth, body, set, request, server, requestId, tenantState }) => {
          const a = actor(auth);
          const ts = tenantOf(tenantState);
          const g = ts ? await liveGroup(ts, body.groupId) : null;
          if (!ts || !g) return notFound(set, requestId, 'Grup');
          const [p] = normalizeGrants([body.permission]);
          if (!p || unknownPermissions([p]).length) {
            set.status = 422;
            return fail('validation_failed', 'Izin tidak dikenal registry (C-4)', requestId, {
              unknown: [body.permission],
            });
          }
          const dup = await ts.tenant.selectOne(
            schema.groupPermissions,
            and(
              eq(schema.groupPermissions.group_id, g.id),
              eq(schema.groupPermissions.permission, p),
            ),
          );
          if (dup) return conflict(set, requestId, 'Izin sudah ada di grup ini');
          const id = newId();
          await ts.tenant.insert(schema.groupPermissions, { id, group_id: g.id, permission: p });
          await writeAudit(unsafeAcrossTenants(), {
            clientId: ts.clientId,
            actorId: a.user.id,
            action: 'group.permission_add',
            resource: 'group',
            resourceId: g.id,
            ip: clientIp(request, server),
            requestId,
            after: { permission: p },
          });
          set.status = 201;
          return ok({ id, groupId: g.id, permission: p });
        },
        {
          beforeHandle: permission('group.edit'),
          body: t.Object({ groupId: Id, permission: t.String({ minLength: 3, maxLength: 191 }) }),
          response: {
            201: OkSchema(
              t.Object({ id: t.String(), groupId: t.String(), permission: t.String() }),
            ),
            ...errorResponses,
          },
          detail: { summary: 'Add one permission to a group' },
        },
      )
      .delete(
        '/:id',
        async ({ auth, params, set, request, server, requestId, tenantState }) => {
          const a = actor(auth);
          const ts = tenantOf(tenantState);
          const row = ts
            ? await ts.tenant.selectOne(
                schema.groupPermissions,
                eq(schema.groupPermissions.id, params.id),
              )
            : null;
          if (!ts || !row) return notFound(set, requestId, 'Izin');
          await ts.tenant.delete(schema.groupPermissions, eq(schema.groupPermissions.id, row.id));
          await writeAudit(unsafeAcrossTenants(), {
            clientId: ts.clientId,
            actorId: a.user.id,
            action: 'group.permission_remove',
            resource: 'group',
            resourceId: row.group_id,
            ip: clientIp(request, server),
            requestId,
            before: { permission: row.permission },
          });
          return ok({ deleted: true as const });
        },
        {
          beforeHandle: permission('group.edit'),
          params: t.Object({ id: Id }),
          response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
          detail: { summary: 'Remove one permission row from its group' },
        },
      ),
  )

  // ---- group-members (C-3) -----------------------------------------------------------------
  .group('/group-members', (r) =>
    r
      .get(
        '/:id',
        async ({ params, query, set, requestId, tenantState }) => {
          const ts = tenantOf(tenantState);
          const g = ts ? await liveGroup(ts, params.id) : null;
          if (!ts || !g) return notFound(set, requestId, 'Grup');
          const p = paging(query, 25);
          const m = await membersOf(ts, g.id, { limit: p.limit, offset: p.offset, q: p.q });
          return page(m.rows, p.meta(m.total));
        },
        {
          beforeHandle: permission('group.read'),
          params: t.Object({ id: Id }),
          query: ListQuery,
          response: {
            200: PageSchema(Member),
            ...errorResponses,
          },
          detail: { summary: "One page of a group's members (`?q` searches name and e-mail)" },
        },
      )
      .post(
        '/:id',
        async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
          const a = actor(auth);
          const ts = tenantOf(tenantState);
          const g = ts ? await liveGroup(ts, params.id) : null;
          if (!ts || !g) return notFound(set, requestId, 'Grup');
          // Only members of THIS tenant can join its groups — a group never reaches outside (B-3).
          if (!(await isMemberOf(unsafeAcrossTenants(), body.userId, ts.clientId))) {
            return notFound(set, requestId, 'Pengguna');
          }
          const dup = await ts.tenant.selectOne(
            schema.groupUserMaps,
            and(
              eq(schema.groupUserMaps.group_id, g.id),
              eq(schema.groupUserMaps.user_id, body.userId),
            ),
          );
          if (dup) return conflict(set, requestId, 'Pengguna sudah anggota grup ini');
          const id = newId();
          await ts.tenant.insert(schema.groupUserMaps, {
            id,
            group_id: g.id,
            user_id: body.userId,
          });
          await writeAudit(unsafeAcrossTenants(), {
            clientId: ts.clientId,
            actorId: a.user.id,
            action: 'group.member_add',
            resource: 'group',
            resourceId: g.id,
            ip: clientIp(request, server),
            requestId,
            after: { userId: body.userId },
          });
          set.status = 201;
          return ok({ id, groupId: g.id, userId: body.userId });
        },
        {
          beforeHandle: permission('group.edit'),
          params: t.Object({ id: Id }),
          body: t.Object({ userId: Id }),
          response: {
            201: OkSchema(t.Object({ id: t.String(), groupId: t.String(), userId: t.String() })),
            ...errorResponses,
          },
          detail: { summary: 'Add a tenant member to a group' },
        },
      )
      .delete(
        '/:id/:userId',
        async ({ auth, params, set, request, server, requestId, tenantState }) => {
          const a = actor(auth);
          const ts = tenantOf(tenantState);
          if (!ts) return notFound(set, requestId, 'Grup');
          const n = await ts.tenant.delete(
            schema.groupUserMaps,
            and(
              eq(schema.groupUserMaps.group_id, params.id),
              eq(schema.groupUserMaps.user_id, params.userId),
            ),
          );
          if (!n) return notFound(set, requestId, 'Keanggotaan');
          await writeAudit(unsafeAcrossTenants(), {
            clientId: ts.clientId,
            actorId: a.user.id,
            action: 'group.member_remove',
            resource: 'group',
            resourceId: params.id,
            ip: clientIp(request, server),
            requestId,
            before: { userId: params.userId },
          });
          return ok({ deleted: true as const });
        },
        {
          beforeHandle: permission('group.edit'),
          params: t.Object({ id: Id, userId: Id }),
          response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
          detail: { summary: 'Remove a member from a group' },
        },
      ),
  );
