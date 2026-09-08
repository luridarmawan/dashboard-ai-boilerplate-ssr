import { writeAudit } from '@core/auth';
import { errorResponses, fail, Id, OkSchema, ok } from '@core/contracts';
import { and, eq, isNull, schema, unsafeAcrossTenants } from '@core/db';
import { INLINE_SAFE } from '@core/storage';
import { Elysia, t } from 'elysia';
import { fileUrl, findFile, readFile, removeFile, storeUpload, uploadLimits } from '../files.ts';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, type TenantState, tenantContext } from '../plugins/tenancy.ts';

/**
 * Files (PRD Q-16): upload with type & size validation, list, fetch, delete — under RBAC and
 * tenancy. `file.create` uploads; a private file is readable by its owner or `file.read` holders;
 * a public file by anyone who can name the tenant (logos, storefront images); `file.manage` lists
 * and deletes everything in the tenant. Bytes are streamed through the API with a content type
 * that cannot be spoofed and, for anything a browser could execute, `Content-Disposition: attachment`.
 */
const FileView = t.Object({
  id: t.String(),
  name: t.String(),
  mime: t.String(),
  size: t.Integer(),
  kind: t.String(),
  visibility: t.String(),
  url: t.String(),
  sha256: t.String(),
  createdAt: t.String(),
  userId: t.Nullable(t.String()),
});
type Row = typeof schema.files.$inferSelect;
const view = (f: Row) => ({
  id: f.id,
  name: f.name,
  mime: f.mime,
  size: f.size,
  kind: f.kind,
  visibility: f.visibility,
  url: fileUrl(f),
  sha256: f.sha256,
  createdAt: f.created_at.toISOString(),
  userId: f.user_id,
});

const canRead = (row: Row, auth: AuthState | null, tenantState: TenantState | undefined) =>
  row.visibility === 'public' ||
  (auth !== null && (row.user_id === auth.user.id || (tenantState?.can('file.read') ?? false)));

export const filesDomain = new Elysia({ name: 'files', prefix: '/files', tags: ['files'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/limits',
    async ({ tenantState }) => {
      const l = await uploadLimits(tenantState?.clientId ?? null);
      return ok({ maxBytes: l.maxBytes, allowedTypes: [...l.allowedTypes] });
    },
    {
      beforeHandle: permission('file.create'),
      response: {
        200: OkSchema(t.Object({ maxBytes: t.Integer(), allowedTypes: t.Array(t.String()) })),
        ...errorResponses,
      },
      detail: { summary: 'Upload limits of the active tenant (size cap, allowed MIME types)' },
    },
  )
  .post(
    '/',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const clientId = tenantState?.clientId ?? null;
      if (!clientId) {
        set.status = 409;
        return fail('conflict', 'Tidak ada tenant aktif', requestId);
      }
      const r = await storeUpload({
        clientId,
        userId: a.user.id,
        file: body.file,
        ...(body.kind ? { kind: body.kind } : {}),
        ...(body.visibility ? { visibility: body.visibility } : {}),
      });
      if (!r.ok) {
        set.status = r.code === 'too_large' ? 413 : 422;
        return fail('validation_failed', r.message, requestId, { reason: r.code });
      }
      await writeAudit(unsafeAcrossTenants(), {
        clientId,
        actorId: a.user.id,
        action: 'file.upload',
        resource: 'file',
        resourceId: r.row.id,
        ip: clientIp(request, server),
        requestId,
        after: {
          name: r.row.name,
          mime: r.row.mime,
          size: r.row.size,
          kind: r.row.kind,
          visibility: r.row.visibility,
        },
      });
      set.status = 201;
      return ok(view(r.row));
    },
    {
      beforeHandle: permission('file.create'),
      body: t.Object({
        file: t.File(),
        kind: t.Optional(t.String({ maxLength: 64, pattern: '^[a-z][a-z0-9_.-]*$' })),
        visibility: t.Optional(t.Union([t.Literal('public'), t.Literal('private')])),
      }),
      response: { 201: OkSchema(FileView), ...errorResponses, 413: errorResponses[422] },
      detail: {
        summary:
          'Upload one file (multipart `file`); validated against the tenant’s size cap and type allowlist, content sniffed (Q-16)',
      },
    },
  )
  .get(
    '/',
    async ({ auth, query, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      if (!tenant) return ok([]);
      const all = query.all === '1' && tenantState.can('file.manage');
      const rows = await tenant.select(
        schema.files,
        and(
          isNull(schema.files.deleted_at),
          all ? undefined : eq(schema.files.user_id, a.user.id),
          query.kind ? eq(schema.files.kind, query.kind) : undefined,
        ),
      );
      const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));
      return ok(
        rows
          .sort((x, y) => y.created_at.getTime() - x.created_at.getTime())
          .slice(0, limit)
          .map(view),
      );
    },
    {
      beforeHandle: permission('file.create'),
      query: t.Object({
        all: t.Optional(t.String()),
        kind: t.Optional(t.String({ maxLength: 64 })),
        limit: t.Optional(t.String()),
      }),
      response: { 200: OkSchema(t.Array(FileView)), ...errorResponses },
      detail: {
        summary: 'My files in the active tenant (?all=1 with file.manage lists everyone’s)',
      },
    },
  )
  .get(
    '/:id',
    async ({ auth, params, set, requestId, tenantState }) => {
      const clientId = tenantState?.clientId ?? null;
      const row = clientId ? await findFile(clientId, params.id) : null;
      if (!row || !canRead(row, auth as AuthState | null, tenantState)) {
        set.status = 404;
        return fail('not_found', 'Berkas tidak ditemukan', requestId);
      }
      return ok(view(row));
    },
    {
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(FileView), ...errorResponses },
      detail: { summary: 'File metadata (public files: anonymous with X-Client-ID)' },
    },
  )
  .get(
    '/:id/content',
    async ({ auth, params, set, requestId, tenantState }) => {
      const clientId = tenantState?.clientId ?? null;
      const row = clientId ? await findFile(clientId, params.id) : null;
      if (!row || !canRead(row, auth as AuthState | null, tenantState)) {
        set.status = 404;
        return fail('not_found', 'Berkas tidak ditemukan', requestId);
      }
      const obj = await readFile(row);
      if (!obj) {
        set.status = 404;
        return fail('not_found', 'Isi berkas tidak ada di penyimpanan', requestId);
      }
      const inline = INLINE_SAFE.has(row.mime);
      const headers: Record<string, string> = {
        'content-type': row.mime,
        'content-length': String(obj.bytes.byteLength),
        'x-content-type-options': 'nosniff',
        'cache-control':
          row.visibility === 'public' ? 'public, max-age=86400' : 'private, no-store',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(row.name)}"`,
        'x-request-id': requestId,
      };
      // SVG may carry scripts: render it, but in a sandbox that cannot run or fetch anything.
      if (row.mime === 'image/svg+xml') {
        headers['content-disposition'] = `inline; filename="${encodeURIComponent(row.name)}"`;
        headers['content-security-policy'] =
          "default-src 'none'; style-src 'unsafe-inline'; sandbox";
      }
      // Wrapped in a Blob: the web project's DOM lib does not accept Uint8Array as a body; Bun does.
      return new Response(new Blob([obj.bytes as unknown as ArrayBuffer]), { headers });
    },
    {
      params: t.Object({ id: Id }),
      response: { 200: t.Unknown(), ...errorResponses },
      detail: {
        summary: 'The bytes; inline for safe images/PDF, attachment otherwise, sandboxed for SVG',
      },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const clientId = tenantState?.clientId ?? null;
      const row = clientId ? await findFile(clientId, params.id) : null;
      if (!row || !clientId || !(row.user_id === a.user.id || tenantState?.can('file.manage'))) {
        set.status = 404;
        return fail('not_found', 'Berkas tidak ditemukan', requestId);
      }
      await removeFile(row);
      await writeAudit(unsafeAcrossTenants(), {
        clientId,
        actorId: a.user.id,
        action: 'file.delete',
        resource: 'file',
        resourceId: row.id,
        ip: clientIp(request, server),
        requestId,
        before: { name: row.name, key: row.key },
      });
      return ok({ deleted: true as const });
    },
    {
      beforeHandle: permission('file.create'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
      detail: {
        summary: 'Delete my file (or any, with file.manage): row soft-deleted, object removed',
      },
    },
  );
