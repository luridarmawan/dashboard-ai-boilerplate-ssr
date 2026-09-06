import { canActInTenant, seedTenantGroups, tenantsOf, writeAudit } from '@core/auth';
import {
  ClientCreateBody,
  ClientUpdateBody,
  errorResponses,
  fail,
  OkSchema,
  ok,
  PageSchema,
  page,
} from '@core/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  newId,
  schema,
  sql,
  unsafeAcrossTenants,
} from '@core/db';
import { Elysia, t } from 'elysia';
import { conflict, Id, ListQuery, likePattern, notFound, paging } from '../lib/http.ts';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';

/**
 * Tenants (PRD B-1, D-3). `clients` is a GLOBAL table: it is the thing tenancy is scoped BY,
 * so this file reads it with the raw connection on purpose, and narrows by membership instead:
 *   - `GET /scope`  what the caller may act in (the switcher's list; any session)
 *   - `GET /`       superadmin sees every live tenant, everyone else their memberships
 *   - `GET/PUT/DELETE /:id` need `client.*` in the active tenant AND the right to act in `:id`
 * A new tenant gets the two system groups (C-3) and its creator as first member + admin, so it
 * is usable immediately. The `default` tenant cannot be deleted (B-5).
 */

const Client = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  parentId: t.Nullable(t.String()),
  settings: t.Nullable(t.Unknown()),
  statusId: t.Integer(),
  createdAt: t.String(),
});
const Scope = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  isDefault: t.Boolean(),
});

type ClientRow = typeof schema.clients.$inferSelect;

function actor(auth: AuthState | null): AuthState {
  if (!auth) throw new Error('guard missing: route reached without a session');
  return auth;
}
function view(c: ClientRow) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    parentId: c.parent_id,
    settings: c.settings ?? null,
    statusId: c.status_id,
    createdAt: c.created_at.toISOString(),
  };
}
async function live(id: string): Promise<ClientRow | null> {
  const [row] = await unsafeAcrossTenants()
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, id), isNull(schema.clients.deleted_at)))
    .limit(1);
  return row ?? null;
}

const requireSession = ({
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

export const clients = new Elysia({ name: 'clients', prefix: '/clients', tags: ['client'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/scope',
    async ({ auth, tenantState }) => {
      const a = actor(auth);
      return ok({
        activeClientId: tenantState?.clientId ?? null,
        tenants: await tenantsOf(unsafeAcrossTenants(), a.user.id),
      });
    },
    {
      beforeHandle: requireSession,
      response: {
        200: OkSchema(
          t.Object({ activeClientId: t.Nullable(t.String()), tenants: t.Array(Scope) }),
        ),
        ...errorResponses,
      },
      detail: { summary: 'Tenants the caller may act in (D-3, B-4) — drives the switcher' },
    },
  )
  .get(
    '/',
    async ({ auth, query }) => {
      const a = actor(auth);
      const p = paging(query);
      const db = unsafeAcrossTenants(); // the tenant table itself; narrowed by membership below
      const search = p.q
        ? sql`(lower(${schema.clients.name}) like ${likePattern(p.q)} or lower(${schema.clients.code}) like ${likePattern(p.q)})`
        : undefined;
      const col =
        query.sort === 'code'
          ? schema.clients.code
          : query.sort === 'created_at'
            ? schema.clients.created_at
            : schema.clients.name;
      const order = p.order === 'desc' ? desc(col) : asc(col);
      if (a.user.is_superadmin) {
        const where = and(isNull(schema.clients.deleted_at), search);
        const [tot] = await db.select({ n: count() }).from(schema.clients).where(where);
        const rows = await db
          .select()
          .from(schema.clients)
          .where(where)
          .orderBy(order)
          .limit(p.limit)
          .offset(p.offset);
        return page(rows.map(view), p.meta(Number(tot?.n ?? 0)));
      }
      const where = and(
        eq(schema.clientUserMaps.user_id, a.user.id),
        isNull(schema.clientUserMaps.deleted_at),
        isNull(schema.clients.deleted_at),
        search,
      );
      const [tot] = await db
        .select({ n: count() })
        .from(schema.clientUserMaps)
        .innerJoin(schema.clients, eq(schema.clients.id, schema.clientUserMaps.client_id))
        .where(where);
      const rows = await db
        .select({ c: schema.clients })
        .from(schema.clientUserMaps)
        .innerJoin(schema.clients, eq(schema.clients.id, schema.clientUserMaps.client_id))
        .where(where)
        .orderBy(order)
        .limit(p.limit)
        .offset(p.offset);
      return page(
        rows.map((r) => view(r.c)),
        p.meta(Number(tot?.n ?? 0)),
      );
    },
    {
      beforeHandle: permission('client.read'),
      query: ListQuery,
      response: { 200: PageSchema(Client), ...errorResponses },
      detail: { summary: 'Tenants: all for a superadmin, otherwise my memberships (D-3)' },
    },
  )
  .get(
    '/:id',
    async ({ auth, params, set, requestId }) => {
      const a = actor(auth);
      const c = await live(params.id);
      if (!c || !(await canActInTenant(unsafeAcrossTenants(), a.user, c.id)))
        return notFound(set, requestId, 'Tenant');
      return ok(view(c));
    },
    {
      beforeHandle: permission('client.read'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(Client), ...errorResponses },
      detail: { summary: 'One tenant I may act in' },
    },
  )
  .post(
    '/',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const [dup] = await db
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(eq(schema.clients.code, body.code))
        .limit(1);
      if (dup) return conflict(set, requestId, `Kode tenant "${body.code}" sudah dipakai`);
      if (body.parentId) {
        const parent = await live(body.parentId);
        if (!parent || !(await canActInTenant(db, a.user, parent.id)))
          return notFound(set, requestId, 'Tenant induk');
      }
      const id = newId();
      await db.insert(schema.clients).values({
        id,
        code: body.code,
        name: body.name.trim(),
        parent_id: body.parentId ?? null,
        settings: body.settings ?? null,
      });
      // Usable at once: system groups, and the creator as its first member and admin (C-3).
      const groups = await seedTenantGroups(db, id);
      await db
        .insert(schema.clientUserMaps)
        .values({ id: newId(), client_id: id, user_id: a.user.id, is_default: false });
      await db.insert(schema.groupUserMaps).values({
        id: newId(),
        client_id: id,
        group_id: groups.admin as string,
        user_id: a.user.id,
      });
      const c = (await live(id)) as ClientRow;
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? id,
        actorId: a.user.id,
        action: 'client.create',
        resource: 'client',
        resourceId: id,
        ip: clientIp(request, server),
        requestId,
        after: view(c),
      });
      set.status = 201;
      return ok(view(c));
    },
    {
      beforeHandle: permission('client.create'),
      body: ClientCreateBody,
      response: { 201: OkSchema(Client), ...errorResponses },
      detail: {
        summary: 'Create a tenant; seeds its system groups and makes the caller its admin',
      },
    },
  )
  .put(
    '/:id',
    async ({ auth, params, body, set, request, server, requestId }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const before = await live(params.id);
      if (!before || !(await canActInTenant(db, a.user, before.id)))
        return notFound(set, requestId, 'Tenant');
      if (body.parentId) {
        if (body.parentId === before.id)
          return conflict(set, requestId, 'Tenant tidak bisa menjadi induk dirinya sendiri');
        const parent = await live(body.parentId);
        if (!parent || !(await canActInTenant(db, a.user, parent.id)))
          return notFound(set, requestId, 'Tenant induk');
      }
      const patch: Partial<typeof schema.clients.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.parentId !== undefined) patch.parent_id = body.parentId;
      if (body.settings !== undefined) patch.settings = body.settings;
      if (body.statusId !== undefined) patch.status_id = body.statusId;
      if (Object.keys(patch).length)
        await db.update(schema.clients).set(patch).where(eq(schema.clients.id, before.id));
      const after = (await live(before.id)) as ClientRow;
      await writeAudit(db, {
        clientId: before.id,
        actorId: a.user.id,
        action: 'client.edit',
        resource: 'client',
        resourceId: before.id,
        ip: clientIp(request, server),
        requestId,
        before: view(before),
        after: view(after),
      });
      return ok(view(after));
    },
    {
      beforeHandle: permission('client.edit'),
      params: t.Object({ id: Id }),
      body: ClientUpdateBody,
      response: { 200: OkSchema(Client), ...errorResponses },
      detail: { summary: 'Edit a tenant (name, parent, settings, status); the code is permanent' },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set, request, server, requestId }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const c = await live(params.id);
      if (!c || !(await canActInTenant(db, a.user, c.id)))
        return notFound(set, requestId, 'Tenant');
      if (c.code === 'default')
        return conflict(set, requestId, 'Tenant baku tidak bisa dihapus (B-5)');
      const [children] = await db
        .select({ n: count() })
        .from(schema.clients)
        .where(and(eq(schema.clients.parent_id, c.id), isNull(schema.clients.deleted_at)));
      if (Number(children?.n ?? 0) > 0)
        return conflict(set, requestId, 'Tenant masih punya sub-tenant');
      await db
        .update(schema.clients)
        .set({ deleted_at: new Date() })
        .where(eq(schema.clients.id, c.id));
      // Sessions parked on this tenant fall back to "no active tenant" on their next request.
      await db
        .update(schema.sessions)
        .set({ client_id: null })
        .where(eq(schema.sessions.client_id, c.id));
      await writeAudit(db, {
        clientId: c.id,
        actorId: a.user.id,
        action: 'client.delete',
        resource: 'client',
        resourceId: c.id,
        ip: clientIp(request, server),
        requestId,
        before: view(c),
      });
      return ok({ deleted: true as const });
    },
    {
      beforeHandle: permission('client.manage'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
      detail: { summary: 'Soft-delete a tenant (never `default`, never one with sub-tenants)' },
    },
  );
