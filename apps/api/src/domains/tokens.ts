import {
  canActInTenant,
  createApiToken,
  isRegistered,
  listApiTokens,
  revokeApiToken,
  writeAudit,
} from '@core/auth';
import { errorResponses, fail, Id, OkSchema, ok } from '@core/contracts';
import { unsafeAcrossTenants } from '@core/db';
import { Elysia, t } from 'elysia';
import { type AuthState, clientIp, sessionOnly } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { tenantContext } from '../plugins/tenancy.ts';

/**
 * API tokens (PRD A-4, Appendix A `tokens`): a logged-in user mints bearer tokens for their own
 * non-browser clients — MCP clients first of all. Rules:
 *   - minted and revoked from a cookie session only (a token cannot mint tokens);
 *   - a token acts as its user, in ONE tenant (the chosen one, or the user's default), and its
 *     scopes can only narrow the user's permissions — enforced in the tenancy plugin, not here;
 *   - the plaintext is returned exactly once; only the hash is stored (like sessions).
 */
const TokenView = t.Object({
  id: t.String(),
  name: t.String(),
  clientId: t.Nullable(t.String()),
  scopes: t.Nullable(t.Array(t.String())),
  expiresAt: t.Nullable(t.String()),
  lastUsedAt: t.Nullable(t.String()),
  createdAt: t.String(),
});
const view = (r: Awaited<ReturnType<typeof listApiTokens>>[number]) => ({
  id: r.id,
  name: r.name,
  clientId: r.client_id,
  scopes: Array.isArray(r.scopes)
    ? (r.scopes as unknown[]).filter((s): s is string => typeof s === 'string')
    : null,
  expiresAt: r.expires_at?.toISOString() ?? null,
  lastUsedAt: r.last_used_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});
const MAX_DAYS = 3650;

export const tokensDomain = new Elysia({ name: 'tokens', prefix: '/tokens', tags: ['tokens'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ auth }) => {
      const a = auth as AuthState;
      return ok((await listApiTokens(unsafeAcrossTenants(), a.user.id)).map(view));
    },
    {
      beforeHandle: sessionOnly,
      response: { 200: OkSchema(t.Array(TokenView)), ...errorResponses },
      detail: { summary: 'My API tokens (never the secret)' },
    },
  )
  .post(
    '/',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const db = unsafeAcrossTenants();
      const scopes = body.scopes?.length ? [...new Set(body.scopes)] : null;
      const unknown = (scopes ?? []).filter((s) => !isRegistered(s));
      if (unknown.length) {
        set.status = 422;
        return fail('validation_failed', `Izin tidak dikenal: ${unknown.join(', ')}`, requestId, {
          scopes: unknown,
        });
      }
      const clientId = body.clientId ?? tenantState?.clientId ?? null;
      if (clientId && !(await canActInTenant(db, a.user, clientId))) {
        set.status = 403;
        return fail('tenant_forbidden', 'Anda bukan anggota tenant yang diminta', requestId);
      }
      const expiresAt = body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 86_400_000)
        : null;
      const created = await createApiToken(db, {
        userId: a.user.id,
        clientId,
        name: body.name,
        scopes,
        expiresAt,
      });
      await writeAudit(db, {
        clientId,
        actorId: a.user.id,
        action: 'token.create',
        resource: 'token',
        resourceId: created.id,
        ip: clientIp(request, server),
        requestId,
        after: { name: body.name, scopes, expiresAt: expiresAt?.toISOString() ?? null },
      });
      set.status = 201;
      return ok({
        id: created.id,
        token: created.token,
        expiresAt: created.expiresAt?.toISOString() ?? null,
      });
    },
    {
      beforeHandle: sessionOnly,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        /** Permission strings; omit for the user's full permissions. Can only narrow. */
        scopes: t.Optional(t.Array(t.String({ maxLength: 120 }), { maxItems: 100 })),
        /** Omit for a token that never expires. */
        expiresInDays: t.Optional(t.Integer({ minimum: 1, maximum: MAX_DAYS })),
        /** Tenant the token acts in; defaults to the session's active tenant. */
        clientId: t.Optional(t.Nullable(Id)),
      }),
      response: {
        201: OkSchema(
          t.Object({ id: t.String(), token: t.String(), expiresAt: t.Nullable(t.String()) }),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Mint an API token for myself; the secret is returned once (A-4)',
      },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const db = unsafeAcrossTenants();
      if (!(await revokeApiToken(db, a.user.id, params.id))) {
        set.status = 404;
        return fail('not_found', 'Token tidak ditemukan', requestId);
      }
      await writeAudit(db, {
        clientId: tenantState?.clientId ?? null,
        actorId: a.user.id,
        action: 'token.revoke',
        resource: 'token',
        resourceId: params.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({ revoked: true as const });
    },
    {
      beforeHandle: sessionOnly,
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ revoked: t.Literal(true) })), ...errorResponses },
      detail: { summary: 'Revoke one of my API tokens' },
    },
  );
