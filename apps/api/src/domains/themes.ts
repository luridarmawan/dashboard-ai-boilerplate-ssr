import { writeAudit } from '@core/auth';
import { errorResponses, fail, OkSchema, ok } from '@core/contracts';
import { eq, schema, unsafeAcrossTenants } from '@core/db';
import { GLOBAL, webRoutes } from '@core/settings';
import { layouts, themeById, themes } from '@core/ui-theme';
import { Elysia, t } from 'elysia';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';
import { emit, settings } from '../services.ts';

/**
 * Themes (PRD L-10, L-11, L-13; Appendix A `themes`): the registry (core + modules) filtered by
 * the tenant's allowlist, the caller's own choice, and the tenant/global default.
 */
const Localized = t.Object({ id: t.String(), en: t.String() });
const Theme = t.Object({
  id: t.String(),
  name: Localized,
  description: Localized,
  icons: t.String(),
  layouts: t.Record(t.String(), t.Record(t.String(), t.String())),
  module: t.String(),
});

function actor(auth: AuthState | null): AuthState {
  if (!auth) throw new Error('guard missing');
  return auth;
}

export const themesDomain = new Elysia({ name: 'themes', prefix: '/themes', tags: ['themes'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ tenantState }) => {
      const clientId = tenantState?.clientId ?? null;
      const allowed = (await settings.get<string[] | null>(clientId, 'app.allowed_themes')) ?? [];
      const def = (await settings.get<string | null>(clientId, 'app.default_theme')) ?? 'base';
      const list = themes().filter((th) => !allowed.length || allowed.includes(th.id));
      return ok({
        default: def,
        allowed: allowed,
        themes: list.map((th) => ({
          id: th.id,
          name: th.name,
          description: th.description,
          icons: th.icons,
          layouts: th.layouts as Record<string, Record<string, string>>,
          module: th.module ?? 'core',
        })),
        layouts: layouts().map((l) => ({
          id: l.id,
          kind: l.kind,
          name: l.name,
          module: l.module ?? 'core',
        })),
      });
    },
    {
      response: {
        200: OkSchema(
          t.Object({
            default: t.String(),
            allowed: t.Array(t.String()),
            themes: t.Array(Theme),
            layouts: t.Array(
              t.Object({ id: t.String(), kind: t.String(), name: Localized, module: t.String() }),
            ),
          }),
        ),
        ...errorResponses,
      },
      detail: {
        summary:
          'Theme registry (core + modules) filtered by the tenant allowlist; anonymous allowed',
      },
    },
  )
  .put(
    '/me',
    async ({ auth, body, set, requestId, tenantState }) => {
      const a = actor(auth);
      const clientId = tenantState?.clientId ?? null;
      const allowed = (await settings.get<string[] | null>(clientId, 'app.allowed_themes')) ?? [];
      if (!themeById(body.theme) || (allowed.length && !allowed.includes(body.theme))) {
        set.status = 422;
        return fail('validation_failed', 'Tema tidak tersedia untuk tenant ini', requestId);
      }
      await unsafeAcrossTenants()
        .update(schema.users)
        .set({ theme: body.theme })
        .where(eq(schema.users.id, a.user.id));
      return ok({ theme: body.theme });
    },
    {
      body: t.Object({ theme: t.String({ maxLength: 64 }) }),
      response: { 200: OkSchema(t.Object({ theme: t.String() })), ...errorResponses },
      detail: { summary: 'My theme choice, within the tenant allowlist (L-11)' },
    },
  )
  .put(
    '/default',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const clientId = body.scope === 'global' ? null : (tenantState?.clientId ?? null);
      if (body.scope === 'global' && !a.user.is_superadmin) {
        set.status = 403;
        return fail(
          'forbidden',
          'Hanya superadmin yang boleh mengubah tema baku global',
          requestId,
        );
      }
      const result = await settings.save(
        clientId,
        [{ key: 'app.default_theme', value: body.theme }],
        { actorId: a.user.id, routes: webRoutes },
      );
      if (Object.keys(result.errors).length) {
        set.status = 422;
        return fail('validation_failed', 'Tema tidak valid', requestId, result.errors);
      }
      await writeAudit(unsafeAcrossTenants(), {
        clientId,
        actorId: a.user.id,
        action: 'theme.default',
        resource: 'theme',
        resourceId: body.theme,
        ip: clientIp(request, server),
        requestId,
        after: { theme: body.theme, scope: clientId ?? GLOBAL },
      });
      emit('config.saved', { section: 'app', key: 'app.default_theme', clientId }, { requestId });
      return ok({ theme: body.theme, scope: clientId ?? GLOBAL });
    },
    {
      beforeHandle: permission('theme.manage'),
      body: t.Object({
        theme: t.String({ maxLength: 64 }),
        scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])),
      }),
      response: {
        200: OkSchema(t.Object({ theme: t.String(), scope: t.String() })),
        ...errorResponses,
      },
      detail: {
        summary:
          'Set the default theme for the tenant (or globally) — L-10; takes effect on every instance at once',
      },
    },
  );
