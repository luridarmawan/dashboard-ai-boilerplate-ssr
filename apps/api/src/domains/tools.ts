import { errorResponses, fail, OkSchema, ok } from '@core/contracts';
import { newId } from '@core/db';
import { Elysia, t } from 'elysia';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { tenantContext } from '../plugins/tenancy.ts';
import { callTool, describeTool, listTools } from '../tools.ts';

/**
 * Tool registry for API clients (extension point 8, I-3, I-6): list what the caller may call in
 * the active tenant, and call one. Both need a session (401 otherwise); visibility and calls go
 * through the same registry the AI chat uses, so there is exactly one permission/tenancy path.
 * The MCP server (FR-I) will wrap these two operations as `tools/list` and `tools/call`.
 */
const Localized = t.Object({ id: t.String(), en: t.String() });
const Descriptor = t.Object({
  name: t.String(),
  wire: t.String(),
  module: t.String(),
  description: Localized,
  permission: t.Nullable(t.String()),
  readOnly: t.Boolean(),
  inputSchema: t.Record(t.String(), t.Unknown()),
});

const requireSession = ({
  auth,
  set,
  request,
}: {
  auth: unknown;
  set: { status?: number | string; headers: Record<string, string | number | undefined> };
  request: Request;
}) => {
  if (auth) return undefined;
  const rid = String(set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId());
  set.status = 401;
  return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', rid);
};

export const toolsDomain = new Elysia({ name: 'tools', prefix: '/tools', tags: ['tools'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ auth, tenantState }) => {
      const a = auth as AuthState;
      const tools = await listTools({
        clientId: tenantState?.clientId ?? null,
        userId: a.user.id,
        can: (p) => tenantState?.can(p) ?? false,
      });
      return ok(tools.map(describeTool));
    },
    {
      beforeHandle: requireSession,
      response: { 200: OkSchema(t.Array(Descriptor)), ...errorResponses },
      detail: {
        summary:
          'AI/MCP tools the caller may call in the active tenant (module enabled, permission held)',
      },
    },
  )
  .post(
    '/call',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const r = await callTool(body.name, body.input ?? {}, {
        clientId: tenantState?.clientId ?? null,
        userId: a.user.id,
        can: (p) => tenantState?.can(p) ?? false,
        locale: a.user.locale ?? 'id',
        requestId,
        signal: request.signal,
        ip: clientIp(request, server),
      });
      if (r.ok) return ok({ name: r.name, result: r.result ?? null, ms: r.ms });
      const status =
        r.code === 'not_found'
          ? 404
          : r.code === 'no_tenant'
            ? 409
            : r.code === 'invalid_input'
              ? 422
              : r.code === 'failed'
                ? 502
                : 403;
      set.status = status;
      return fail(
        r.code === 'not_found'
          ? 'not_found'
          : r.code === 'no_tenant'
            ? 'conflict'
            : r.code === 'invalid_input'
              ? 'validation_failed'
              : r.code === 'failed'
                ? 'service_unavailable'
                : r.code === 'module_disabled'
                  ? 'module_disabled'
                  : 'forbidden',
        r.message,
        requestId,
        { tool: r.name, reason: r.code },
      );
    },
    {
      beforeHandle: requireSession,
      body: t.Object({
        name: t.String({ minLength: 3, maxLength: 80 }),
        input: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
      response: {
        200: OkSchema(t.Object({ name: t.String(), result: t.Unknown(), ms: t.Integer() })),
        ...errorResponses,
      },
      detail: {
        summary: 'Call a tool by name (<ns>.<name> or <ns>_<name>); permission and tenant enforced',
      },
    },
  );
