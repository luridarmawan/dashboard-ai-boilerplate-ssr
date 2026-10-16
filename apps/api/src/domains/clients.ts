import {
  canActInTenant,
  detachTenantFromSessions,
  seedTenantGroups,
  tenantsOf,
  writeAudit,
} from '@core/auth';
import {
  ClientCreateBody,
  ClientUpdateBody,
  codeFromName,
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
  inArray,
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

/** The parent tenant, resolved so lists and forms can show its name without a second call. */
const ParentRef = t.Object({ id: t.String(), code: t.String(), name: t.String() });
/**
 * Profile columns (groundwork for later features): API key ↔ column. Everything here is
 * optional on the way in and nullable on the way out, except the two ledger amounts, which are
 * decimal strings that default to "0" — money never travels as a float.
 */
const PROFILE = {
  description: 'description',
  referenceId: 'reference_id',
  balance: 'balance',
  totalReceipts: 'total_receipts',
  address: 'address',
  rt: 'rt',
  rw: 'rw',
  postalCode: 'postal_code',
  kelurahan: 'kelurahan',
  kelurahanId: 'kelurahan_id',
  kecamatan: 'kecamatan',
  kecamatanId: 'kecamatan_id',
  city: 'city',
  cityId: 'city_id',
  regency: 'regency',
  province: 'province',
  provinceId: 'province_id',
  region: 'region',
  regionId: 'region_id',
  countryId: 'country_id',
  latitude: 'latitude',
  longitude: 'longitude',
  mapsUrl: 'maps_url',
  url: 'url',
} as const;
type ProfileKey = keyof typeof PROFILE;
const PROFILE_KEYS = Object.keys(PROFILE) as ProfileKey[];
const MONEY_KEYS: ReadonlySet<ProfileKey> = new Set(['balance', 'totalReceipts']);
const Client = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  parentId: t.Nullable(t.String()),
  parent: t.Nullable(ParentRef),
  settings: t.Nullable(t.Unknown()),
  statusId: t.Integer(),
  createdAt: t.String(),
  // Profile block — spelled out so the OpenAPI document and the typed client see each field.
  description: t.Nullable(t.String()),
  referenceId: t.Nullable(t.String()),
  /** `YYYY-MM-DD`. */
  joinDate: t.Nullable(t.String()),
  balance: t.String(),
  totalReceipts: t.String(),
  address: t.Nullable(t.String()),
  rt: t.Nullable(t.String()),
  rw: t.Nullable(t.String()),
  postalCode: t.Nullable(t.String()),
  kelurahan: t.Nullable(t.String()),
  kelurahanId: t.Nullable(t.String()),
  kecamatan: t.Nullable(t.String()),
  kecamatanId: t.Nullable(t.String()),
  city: t.Nullable(t.String()),
  cityId: t.Nullable(t.String()),
  regency: t.Nullable(t.String()),
  province: t.Nullable(t.String()),
  provinceId: t.Nullable(t.String()),
  region: t.Nullable(t.String()),
  regionId: t.Nullable(t.String()),
  countryId: t.Nullable(t.String()),
  latitude: t.Nullable(t.String()),
  longitude: t.Nullable(t.String()),
  mapsUrl: t.Nullable(t.String()),
  url: t.Nullable(t.String()),
});
const Scope = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  isDefault: t.Boolean(),
});

type ClientRow = typeof schema.clients.$inferSelect;
type ParentRow = typeof ParentRef.static;
type Db = ReturnType<typeof unsafeAcrossTenants>;

function actor(auth: AuthState | null): AuthState {
  if (!auth) throw new Error('guard missing: route reached without a session');
  return auth;
}
type ProfileBody = { [K in ProfileKey]?: string | null };
type ClientInsert = typeof schema.clients.$inferInsert;
const DECIMAL_KEYS: ReadonlySet<ProfileKey> = new Set([...MONEY_KEYS, 'latitude', 'longitude']);
/**
 * Decimal columns come back dialect-flavoured — "0.0000" from MySQL and PostgreSQL, "0" from
 * SQLite's TEXT — so the API trims the fraction's trailing zeros and answers the same on all three.
 */
function plainDecimal(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
function view(c: ClientRow, parent: ParentRow | null = null) {
  const profile = Object.fromEntries(
    PROFILE_KEYS.map((k) => {
      const raw = c[PROFILE[k]] ?? (MONEY_KEYS.has(k) ? '0' : null);
      return [k, raw !== null && DECIMAL_KEYS.has(k) ? plainDecimal(String(raw)) : raw];
    }),
  ) as Record<ProfileKey, string | null> & Record<'balance' | 'totalReceipts', string>;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    parentId: c.parent_id,
    parent,
    settings: c.settings ?? null,
    statusId: c.status_id,
    createdAt: c.created_at.toISOString(),
    ...profile,
    joinDate: c.join_date ? c.join_date.toISOString().slice(0, 10) : null,
  };
}
/** Only the profile keys the body carries; `null` clears a column, and clears money to "0". */
function profilePatch(body: ProfileBody): Partial<ClientInsert> {
  const patch: Record<string, string | null> = {};
  for (const k of PROFILE_KEYS) {
    const v = body[k];
    if (v === undefined) continue;
    patch[PROFILE[k]] = v === null && MONEY_KEYS.has(k) ? '0' : v;
  }
  return patch as Partial<ClientInsert>;
}
/**
 * `joinDate` → the `join_date` column: a calendar day kept at 00:00 UTC, so it reads back as
 * the same `YYYY-MM-DD` in every time zone. `undefined` = untouched, `null` = cleared, and a
 * date the calendar does not have (`2026-02-30`) is `invalid` — the schema only checks shape.
 */
function joinDateValue(v: string | null | undefined): Date | null | undefined | 'invalid' {
  if (v === undefined || v === null) return v;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? 'invalid' : d;
}
function invalidJoinDate(set: { status?: number | string }, requestId: string) {
  set.status = 422;
  return fail('validation_failed', 'Periksa isian', requestId, {
    joinDate: 'Tanggal tidak ada di kalender',
  });
}
/** Region code field → the name field it names, when the code is in `regions`. */
const REGION_NAMES = [
  ['provinceId', 'province'],
  ['cityId', 'city'],
  ['kecamatanId', 'kecamatan'],
  ['kelurahanId', 'kelurahan'],
] as const;
/**
 * Fills a region's name from its code when the body sends the code but not the name, so a
 * picker only has to post codes. A cleared code clears its name too. A code that is not in
 * `regions` (no data loaded, or another scheme) leaves the name to the caller.
 */
async function withRegionNames(db: Db, body: ProfileBody): Promise<ProfileBody> {
  const out: ProfileBody = { ...body };
  const wanted: string[] = [];
  for (const [idKey, nameKey] of REGION_NAMES) {
    if (body[nameKey] !== undefined) continue;
    const code = body[idKey];
    if (code === null) out[nameKey] = null;
    else if (code) wanted.push(code);
  }
  if (!wanted.length) return out;
  const found = new Map(
    (
      await db
        .select({ code: schema.regions.code, name: schema.regions.name })
        .from(schema.regions)
        .where(inArray(schema.regions.code, wanted))
    ).map((r) => [r.code, r.name]),
  );
  for (const [idKey, nameKey] of REGION_NAMES) {
    const code = body[idKey];
    const name = code ? found.get(code) : undefined;
    if (body[nameKey] === undefined && name !== undefined) out[nameKey] = name;
  }
  return out;
}
/**
 * Parents of a page of tenants in one query, keyed by id. A deleted parent is still reported:
 * the link exists in the data, and hiding it would make the child look like a root.
 */
async function parentsOf(db: Db, rows: ClientRow[]): Promise<Map<string, ParentRow>> {
  const ids = [...new Set(rows.map((r) => r.parent_id).filter((x): x is string => !!x))];
  const map = new Map<string, ParentRow>();
  if (!ids.length) return map;
  const parents = await db
    .select({ id: schema.clients.id, code: schema.clients.code, name: schema.clients.name })
    .from(schema.clients)
    .where(inArray(schema.clients.id, ids));
  for (const p of parents) map.set(p.id, p);
  return map;
}
function withParents(rows: ClientRow[], parents: Map<string, ParentRow>) {
  return rows.map((r) => view(r, r.parent_id ? (parents.get(r.parent_id) ?? null) : null));
}
async function viewWithParent(db: Db, c: ClientRow) {
  return withParents([c], await parentsOf(db, [c]))[0] as ReturnType<typeof view>;
}
/**
 * Walks up from `candidateId` through `parent_id`. True when `tenantId` is on that path, i.e.
 * making `candidateId` the parent of `tenantId` would close a loop. The visited set stops the
 * walk if the data already holds a cycle, so a bad row cannot hang the request.
 */
async function wouldCycle(db: Db, candidateId: string, tenantId: string): Promise<boolean> {
  const seen = new Set<string>();
  let cur: string | null = candidateId;
  while (cur && !seen.has(cur)) {
    if (cur === tenantId) return true;
    seen.add(cur);
    const [row] = await db
      .select({ parentId: schema.clients.parent_id })
      .from(schema.clients)
      .where(eq(schema.clients.id, cur))
      .limit(1);
    cur = row?.parentId ?? null;
  }
  return false;
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
        tenants: await tenantsOf(unsafeAcrossTenants(), a.user),
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
      detail: {
        summary: 'List my tenants',
        description: 'Tenants you can act in; feeds the tenant switcher.',
      },
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
        return page(withParents(rows, await parentsOf(db, rows)), p.meta(Number(tot?.n ?? 0)));
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
      const mine = rows.map((r) => r.c);
      return page(withParents(mine, await parentsOf(db, mine)), p.meta(Number(tot?.n ?? 0)));
    },
    {
      beforeHandle: permission('client.read'),
      query: ListQuery,
      response: { 200: PageSchema(Client), ...errorResponses },
      detail: {
        summary: 'List tenants',
        description: 'All tenants for a superadmin, otherwise your memberships.',
      },
    },
  )
  .get(
    '/:id',
    async ({ auth, params, set, requestId }) => {
      const a = actor(auth);
      const c = await live(params.id);
      if (!c || !(await canActInTenant(unsafeAcrossTenants(), a.user, c.id)))
        return notFound(set, requestId, 'Tenant');
      return ok(await viewWithParent(unsafeAcrossTenants(), c));
    },
    {
      beforeHandle: permission('client.read'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(Client), ...errorResponses },
      detail: { summary: 'Get a tenant' },
    },
  )
  .post(
    '/',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      // No code given: derive one from the name. A name with nothing usable in it is told so,
      // field-wise, instead of being handed a made-up code.
      const code = body.code ?? codeFromName(body.name, 32);
      if (code.length < 2) {
        set.status = 422;
        return fail('validation_failed', 'Periksa isian', requestId, {
          code: 'Kode tidak bisa diturunkan dari nama ini; isi kode sendiri',
        });
      }
      const [dup] = await db
        .select({ id: schema.clients.id, deletedAt: schema.clients.deleted_at })
        .from(schema.clients)
        .where(eq(schema.clients.code, code))
        .limit(1);
      /**
       * A deleted tenant keeps its code — and, unlike a group or an AI profile, ALL of its data:
       * users, files, AI calls. Reviving it silently because someone typed the same code would
       * hand a new tenant someone else's rows, so this stays a refusal. It just says which kind
       * of refusal it is, instead of pointing at a tenant nobody can see.
       */
      if (dup)
        return conflict(
          set,
          requestId,
          dup.deletedAt
            ? `Kode tenant "${code}" masih dipegang tenant yang sudah dihapus; datanya tidak ikut terhapus, jadi kode itu tidak dipakai ulang — pilih kode lain`
            : `Kode tenant "${code}" sudah dipakai`,
        );
      if (body.parentId) {
        const parent = await live(body.parentId);
        if (!parent || !(await canActInTenant(db, a.user, parent.id)))
          return notFound(set, requestId, 'Tenant induk');
      }
      const joinDate = joinDateValue(body.joinDate);
      if (joinDate === 'invalid') return invalidJoinDate(set, requestId);
      const id = newId();
      await db.insert(schema.clients).values({
        id,
        code,
        name: body.name.trim(),
        parent_id: body.parentId ?? null,
        settings: body.settings ?? null,
        join_date: joinDate ?? null,
        ...profilePatch(await withRegionNames(db, body)),
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
      return ok(await viewWithParent(db, c));
    },
    {
      beforeHandle: permission('client.create'),
      body: ClientCreateBody,
      response: { 201: OkSchema(Client), ...errorResponses },
      detail: {
        summary: 'Create a tenant',
        description:
          'Seeds its system groups and makes you its admin. Without `code`, one is derived from the name (lower case, runs of other characters become `_`). `parentId` places it under another tenant you can act in; omit it for a top-level tenant.',
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
        // A tenant cannot move under one of its own descendants.
        if (await wouldCycle(db, parent.id, before.id))
          return conflict(
            set,
            requestId,
            'Tenant induk yang dipilih adalah sub-tenant dari tenant ini; pilih tenant lain',
          );
      }
      const joinDate = joinDateValue(body.joinDate);
      if (joinDate === 'invalid') return invalidJoinDate(set, requestId);
      const patch: Partial<ClientInsert> = profilePatch(await withRegionNames(db, body));
      if (joinDate !== undefined) patch.join_date = joinDate;
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
      return ok(await viewWithParent(db, after));
    },
    {
      beforeHandle: permission('client.edit'),
      params: t.Object({ id: Id }),
      body: ClientUpdateBody,
      response: { 200: OkSchema(Client), ...errorResponses },
      detail: {
        summary: 'Update a tenant',
        description:
          'Name, parent, settings, status and the profile block (description, reference id, join date, ledger amounts, address and region fields, coordinates, links). The code cannot change. A null `parentId` makes it a top-level tenant; a parent that is one of its own sub-tenants is refused. Amounts and coordinates are decimal strings; `joinDate` is `YYYY-MM-DD`.',
      },
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
      if (c.code === 'default') return conflict(set, requestId, 'Tenant baku tidak bisa dihapus');
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
      await detachTenantFromSessions(db, c.id);
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
      detail: {
        summary: 'Delete a tenant',
        description: 'Refused for `default` and for tenants that have sub-tenants.',
      },
    },
  );
