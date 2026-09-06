import { writeAudit } from '@core/auth';
import { errorResponses, fail, OkSchema, ok } from '@core/contracts';
import { unsafeAcrossTenants } from '@core/db';
import { modules } from '@core/module-kit/registry';
import { GLOBAL } from '@core/settings';
import { Elysia, t } from 'elysia';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';
import { emit, moduleState } from '../services.ts';

/** Installed modules and their per-tenant state (PRD G-8; Appendix A `module`). */
function actor(auth: AuthState | null): AuthState {
  if (!auth) throw new Error('guard missing');
  return auth;
}

export const moduleDomain = new Elysia({ name: 'module', prefix: '/module', tags: ['module'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/enabled',
    async ({ tenantState }) => {
      // Anonymous allowed: the web shell needs it to hide menus/widgets/themes of disabled modules (G-8).
      const enabled = await moduleState.enabledFor(tenantState?.clientId ?? null);
      return ok(
        modules.filter((m) => enabled.has(m.name)).map((m) => ({ name: m.name, ns: m.ns })),
      );
    },
    {
      response: {
        200: OkSchema(t.Array(t.Object({ name: t.String(), ns: t.String() }))),
        ...errorResponses,
      },
      detail: {
        summary: 'Modules enabled for the active tenant (names + namespaces); anonymous allowed',
      },
    },
  )
  .get(
    '/',
    async ({ auth, tenantState }) => {
      actor(auth);
      const states = await moduleState.listFor(tenantState?.clientId ?? null);
      return ok(
        modules.map((m) => {
          const s = states.find((x) => x.module === m.name);
          return {
            name: m.name,
            ns: m.ns,
            version: m.version,
            source: m.source,
            globalEnabled: s?.globalEnabled ?? true,
            tenantEnabled: s?.tenantEnabled ?? null,
            effective: s?.effective ?? true,
          };
        }),
      );
    },
    {
      beforeHandle: permission('module.read'),
      response: {
        200: OkSchema(
          t.Array(
            t.Object({
              name: t.String(),
              ns: t.String(),
              version: t.String(),
              source: t.String(),
              globalEnabled: t.Boolean(),
              tenantEnabled: t.Nullable(t.Boolean()),
              effective: t.Boolean(),
            }),
          ),
        ),
        ...errorResponses,
      },
      detail: { summary: 'Installed modules with global and active-tenant state (G-8)' },
    },
  )
  .put(
    '/:id/enabled',
    async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const mod = modules.find((m) => m.name === params.id || m.ns === params.id);
      if (!mod) {
        set.status = 404;
        return fail('not_found', 'Modul tidak terpasang', requestId);
      }
      const clientId = body.scope === 'global' ? null : (tenantState?.clientId ?? null);
      if (body.scope === 'global' && !a.user.is_superadmin) {
        set.status = 403;
        return fail(
          'forbidden',
          'Hanya superadmin yang boleh mengubah state modul global',
          requestId,
        );
      }
      if (body.enabled === null) {
        if (!clientId) {
          set.status = 422;
          return fail(
            'validation_failed',
            'Scope global tidak punya override untuk dihapus',
            requestId,
          );
        }
        await moduleState.clearOverride(clientId, mod.name);
      } else {
        await moduleState.setEnabled(clientId, mod.name, body.enabled, a.user.id);
      }
      await writeAudit(unsafeAcrossTenants(), {
        clientId,
        actorId: a.user.id,
        action: 'module.toggle',
        resource: 'module',
        resourceId: mod.name,
        ip: clientIp(request, server),
        requestId,
        after: { enabled: body.enabled, scope: clientId ?? GLOBAL },
      });
      if (clientId)
        emit(
          'module.toggled',
          { module: mod.name, clientId, enabled: body.enabled ?? true },
          { requestId },
        );
      const states = await moduleState.listFor(clientId);
      return ok(
        states.find((s) => s.module === mod.name) ?? {
          module: mod.name,
          globalEnabled: true,
          tenantEnabled: null,
          effective: true,
        },
      );
    },
    {
      beforeHandle: permission('module.manage'),
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
      body: t.Object({
        /** null removes the tenant override (falls back to global). */
        enabled: t.Nullable(t.Boolean()),
        scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])),
      }),
      response: {
        200: OkSchema(
          t.Object({
            module: t.String(),
            globalEnabled: t.Boolean(),
            tenantEnabled: t.Nullable(t.Boolean()),
            effective: t.Boolean(),
          }),
        ),
        ...errorResponses,
      },
      detail: {
        summary:
          'Enable/disable a module for the tenant (or globally); its menu, routes, widgets and themes follow (G-8)',
      },
    },
  );
