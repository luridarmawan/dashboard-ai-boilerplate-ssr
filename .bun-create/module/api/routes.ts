import { type AuthState, clientIp } from '@app/api/plugins/auth';
import { requestContext } from '@app/api/plugins/request-context';
import { permission, tenantContext } from '@app/api/plugins/tenancy';
import { writeAudit } from '@core/auth';
import {
  errorResponses,
  fail,
  Id,
  OkSchema,
  ok,
  PageSchema,
  page,
  pageMeta,
} from '@core/contracts';
import { and, eq, isNull, newId, schema, unsafeAcrossTenants } from '@core/db';
import { defineApiRoutes } from '@core/module-kit';
import { Elysia, t } from 'elysia';
import { NoteBody, NoteUpdateBody } from './schemas.ts';

/** API (extension point 2), mounted at /v1/m/hello. CRUD through the tenant facade; every mutation audited. */
type Row = typeof schema.helloNotes.$inferSelect;
const Note = t.Object({
  id: t.String(),
  title: t.Nullable(t.String()),
  body: t.Nullable(t.String()),
  pinned: t.Boolean(),
  createdAt: t.String(),
  updatedAt: t.String(),
});
const view = (r: Row) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  pinned: r.pinned,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const toRow = (b: Partial<typeof NoteBody.static>) => ({
  ...(b.title !== undefined ? { title: b.title } : {}),
  ...(b.body !== undefined ? { body: b.body } : {}),
  ...(b.pinned !== undefined ? { pinned: b.pinned } : {}),
});

export default defineApiRoutes(
  'Hello',
  new Elysia({ name: 'module:hello', tags: ['module:hello'] })
    .use(requestContext)
    .use(tenantContext)
    .get(
      '/notes',
      async ({ query, tenantState }) => {
        if (!tenantState?.tenant) return page([], pageMeta(1, 20, 0));
        const rows = await tenantState.tenant.select(
          schema.helloNotes,
          isNull(schema.helloNotes.deleted_at),
        );
        const q = query.q?.toLowerCase();
        const list = rows
          .filter(
            (r) =>
              !q ||
              String(r.title ?? '')
                .toLowerCase()
                .includes(q),
          )
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        const p = Math.max(1, Number(query.page ?? 1));
        const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
        return page(
          list.slice((p - 1) * limit, p * limit).map(view),
          pageMeta(p, limit, list.length),
        );
      },
      {
        beforeHandle: permission('hello.note.read'),
        query: t.Object({
          q: t.Optional(t.String()),
          page: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
        response: { 200: PageSchema(Note), ...errorResponses },
        detail: { summary: 'List notes of the active tenant' },
      },
    )
    .get(
      '/notes/:id',
      async ({ params, set, requestId, tenantState }) => {
        const row = tenantState?.tenant
          ? await tenantState.tenant.selectOne(
              schema.helloNotes,
              and(eq(schema.helloNotes.id, params.id), isNull(schema.helloNotes.deleted_at)),
            )
          : null;
        if (!row) {
          set.status = 404;
          return fail('not_found', 'Note tidak ditemukan', requestId);
        }
        return ok(view(row));
      },
      {
        beforeHandle: permission('hello.note.read'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(Note), ...errorResponses },
        detail: { summary: 'One note' },
      },
    )
    .post(
      '/notes',
      async ({ auth, body, set, request, server, requestId, tenantState }) => {
        const tenant = tenantState?.tenant;
        if (!tenant || !tenantState.clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        const id = newId();
        await tenant.insert(schema.helloNotes, { id, ...toRow(body) } as never);
        const row = (await tenant.selectOne(
          schema.helloNotes,
          eq(schema.helloNotes.id, id),
        )) as Row;
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: (auth as AuthState | null)?.user.id ?? null,
          action: 'hello.note.create',
          resource: 'hello.note',
          resourceId: id,
          ip: clientIp(request, server),
          requestId,
          after: view(row),
        });
        set.status = 201;
        return ok(view(row));
      },
      {
        beforeHandle: permission('hello.note.create'),
        body: NoteBody,
        response: { 201: OkSchema(Note), ...errorResponses },
        detail: { summary: 'Create a note' },
      },
    )
    .put(
      '/notes/:id',
      async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
        const tenant = tenantState?.tenant;
        const before = tenant
          ? await tenant.selectOne(
              schema.helloNotes,
              and(eq(schema.helloNotes.id, params.id), isNull(schema.helloNotes.deleted_at)),
            )
          : null;
        if (!tenant || !before || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Note tidak ditemukan', requestId);
        }
        const patch = toRow(body);
        if (Object.keys(patch).length)
          await tenant.update(
            schema.helloNotes,
            patch as never,
            eq(schema.helloNotes.id, before.id),
          );
        const after = (await tenant.selectOne(
          schema.helloNotes,
          eq(schema.helloNotes.id, before.id),
        )) as Row;
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: (auth as AuthState | null)?.user.id ?? null,
          action: 'hello.note.edit',
          resource: 'hello.note',
          resourceId: before.id,
          ip: clientIp(request, server),
          requestId,
          before: view(before),
          after: view(after),
        });
        return ok(view(after));
      },
      {
        beforeHandle: permission('hello.note.edit'),
        params: t.Object({ id: Id }),
        body: NoteUpdateBody,
        response: { 200: OkSchema(Note), ...errorResponses },
        detail: { summary: 'Edit a note' },
      },
    )
    .delete(
      '/notes/:id',
      async ({ auth, params, set, request, server, requestId, tenantState }) => {
        const tenant = tenantState?.tenant;
        const row = tenant
          ? await tenant.selectOne(
              schema.helloNotes,
              and(eq(schema.helloNotes.id, params.id), isNull(schema.helloNotes.deleted_at)),
            )
          : null;
        if (!tenant || !row || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Note tidak ditemukan', requestId);
        }
        await tenant.update(
          schema.helloNotes,
          { deleted_at: new Date() } as never,
          eq(schema.helloNotes.id, row.id),
        );
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: (auth as AuthState | null)?.user.id ?? null,
          action: 'hello.note.delete',
          resource: 'hello.note',
          resourceId: row.id,
          ip: clientIp(request, server),
          requestId,
          before: view(row),
        });
        return ok({ deleted: true as const });
      },
      {
        beforeHandle: permission('hello.note.manage'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
        detail: { summary: 'Soft-delete a note' },
      },
    ),
);
