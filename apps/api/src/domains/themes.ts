import { writeAudit } from '@core/auth';
import { errorResponses, fail, Id, OkSchema, ok } from '@core/contracts';
import { eq, schema, unsafeAcrossTenants } from '@core/db';
import { type CustomThemeInput, GLOBAL, viewCustomTheme, webRoutes } from '@core/settings';
import { ALL_TOKENS, ICON_SETS, layouts, themeById, themes } from '@core/ui-theme';
import { Elysia, t } from 'elysia';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';
import { customThemes, emit, settings } from '../services.ts';

/**
 * Themes (PRD L-10, L-11, L-13, L-24; Appendix A `themes`): the registry (core + modules + the
 * admin-assembled themes of the active tenant) filtered by the tenant's allowlist, the caller's
 * own choice, the tenant/global default, and the editor's CRUD over custom themes.
 */
const Localized = t.Object({ id: t.String(), en: t.String() });
const Theme = t.Object({
  id: t.String(),
  name: Localized,
  description: Localized,
  icons: t.String(),
  layouts: t.Record(t.String(), t.Record(t.String(), t.String())),
  module: t.String(),
  custom: t.Boolean(),
});
const Tokens = t.Object({
  light: t.Record(t.String(), t.String({ maxLength: 200 })),
  dark: t.Record(t.String(), t.String({ maxLength: 200 })),
});
const CustomThemeBody = t.Object({
  slug: t.String({ minLength: 1, maxLength: 40 }),
  name: Localized,
  description: t.Optional(t.Nullable(Localized)),
  base: t.String({ maxLength: 64 }),
  icons: t.String({ maxLength: 64 }),
  layouts: t.Record(t.String(), t.Record(t.String(), t.String({ maxLength: 64 }))),
  tokens: Tokens,
  enabled: t.Optional(t.Boolean()),
  /** `global` needs superadmin; default = the active tenant. */
  scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])),
});
const CustomThemeView = t.Object({
  id: t.String(),
  scope: t.String(),
  code: t.String(),
  name: Localized,
  description: t.Nullable(Localized),
  base: t.String(),
  icons: t.String(),
  layouts: t.Record(t.String(), t.Record(t.String(), t.String())),
  tokens: Tokens,
  enabled: t.Boolean(),
  createdAt: t.String(),
  updatedAt: t.String(),
});
/** A theme id is usable for this tenant when it is a file theme or one of its custom themes. */
async function themeExists(clientId: string | null, id: string): Promise<boolean> {
  if (themeById(id)) return true;
  return (await customThemes.listFor(clientId)).some((c) => c.code === id);
}

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
      const custom = (await customThemes.manifestsFor(clientId)).map((c) => c.manifest);
      const list = [...themes(), ...custom].filter(
        (th) => !allowed.length || allowed.includes(th.id),
      );
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
          custom: th.custom === true,
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
      if (
        !(await themeExists(clientId, body.theme)) ||
        (allowed.length && !allowed.includes(body.theme))
      ) {
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
      if (!(await themeExists(clientId, body.theme))) {
        set.status = 422;
        return fail('validation_failed', `Tema "${body.theme}" tidak terdaftar`, requestId);
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
  )
  // ---- admin-assembled themes (L-24) ----
  .get(
    '/custom',
    async ({ tenantState }) =>
      ok(
        (await customThemes.manifestsFor(tenantState?.clientId ?? null)).map((c) => ({
          id: c.manifest.id,
          name: c.manifest.name,
          description: c.manifest.description,
          icons: c.manifest.icons,
          layouts: c.manifest.layouts as Record<string, Record<string, string>>,
          css: c.css,
        })),
      ),
    {
      response: {
        200: OkSchema(
          t.Array(
            t.Object({
              id: t.String(),
              name: Localized,
              description: Localized,
              icons: t.String(),
              layouts: t.Record(t.String(), t.Record(t.String(), t.String())),
              css: t.String(),
            }),
          ),
        ),
        ...errorResponses,
      },
      detail: {
        summary:
          'Custom themes usable by the active tenant with their CSS — the web app injects it per request (L-24); anonymous allowed',
      },
    },
  )
  .get(
    '/custom/mine',
    async ({ auth, query, set, requestId, tenantState }) => {
      const a = actor(auth);
      if (query.scope === 'global' && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Hanya superadmin yang boleh mengelola tema global', requestId);
      }
      const scope = query.scope === 'global' ? null : (tenantState?.clientId ?? null);
      return ok({
        scope: scope ?? GLOBAL,
        themes: (await customThemes.listOwned(scope)).map(viewCustomTheme),
        iconSets: Object.entries(ICON_SETS).map(([id, s]) => ({ id, name: s.name })),
        layouts: layouts().map((l) => ({ id: l.id, kind: l.kind, name: l.name })),
        tokens: [...ALL_TOKENS],
        bases: themes().map((th) => ({ id: th.id, name: th.name })),
      });
    },
    {
      beforeHandle: permission('theme.manage'),
      query: t.Object({ scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])) }),
      response: {
        200: OkSchema(
          t.Object({
            scope: t.String(),
            themes: t.Array(CustomThemeView),
            iconSets: t.Array(t.Object({ id: t.String(), name: Localized })),
            layouts: t.Array(t.Object({ id: t.String(), kind: t.String(), name: Localized })),
            tokens: t.Array(t.String()),
            bases: t.Array(t.Object({ id: t.String(), name: Localized })),
          }),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Custom themes owned by the tenant (or global) plus the editor vocabulary',
      },
    },
  )
  .get(
    '/custom/:id',
    async ({ auth, params, set, requestId, tenantState }) => {
      const a = actor(auth);
      const row = await customThemes.byId(params.id);
      const mine =
        row &&
        (row.scope === (tenantState?.clientId ?? '') ||
          (row.scope === GLOBAL && a.user.is_superadmin));
      if (!row || !mine) {
        set.status = 404;
        return fail('not_found', 'Tema tidak ditemukan', requestId);
      }
      return ok(viewCustomTheme(row));
    },
    {
      beforeHandle: permission('theme.manage'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(CustomThemeView), ...errorResponses },
      detail: { summary: 'One custom theme for the editor' },
    },
  )
  .post(
    '/custom',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      if (body.scope === 'global' && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Hanya superadmin yang boleh membuat tema global', requestId);
      }
      const scope = body.scope === 'global' ? null : (tenantState?.clientId ?? null);
      if (body.scope !== 'global' && !scope) {
        set.status = 409;
        return fail('conflict', 'Tidak ada tenant aktif', requestId);
      }
      const r = await customThemes.create(scope, body as CustomThemeInput, a.user.id);
      if (!r.ok) {
        set.status = r.code === 'conflict' ? 409 : 422;
        return fail(
          r.code === 'conflict' ? 'conflict' : 'validation_failed',
          r.code === 'conflict'
            ? 'Slug sudah dipakai'
            : 'Tema belum memenuhi kontrak (L-5, L-8, L-21)',
          requestId,
          { errors: r.errors, contrast: r.contrast },
        );
      }
      await writeAudit(unsafeAcrossTenants(), {
        clientId: scope,
        actorId: a.user.id,
        action: 'theme.create',
        resource: 'theme',
        resourceId: r.row.code,
        ip: clientIp(request, server),
        requestId,
        after: { base: body.base, icons: body.icons },
      });
      set.status = 201;
      return ok(viewCustomTheme(r.row));
    },
    {
      beforeHandle: permission('theme.manage'),
      body: CustomThemeBody,
      response: { 201: OkSchema(CustomThemeView), ...errorResponses },
      detail: {
        summary:
          'Assemble a new theme from tokens + a registered icon set and layouts; refused unless it passes WCAG AA (L-24, L-21)',
      },
    },
  )
  .put(
    '/custom/:id',
    async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const existing = await customThemes.byId(params.id);
      const scope = existing?.scope === GLOBAL ? null : (tenantState?.clientId ?? null);
      if (existing?.scope === GLOBAL && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Hanya superadmin yang boleh mengubah tema global', requestId);
      }
      const r = await customThemes.update(scope, params.id, body as CustomThemeInput, a.user.id);
      if (!r.ok) {
        set.status = r.code === 'not_found' ? 404 : r.code === 'conflict' ? 409 : 422;
        return fail(
          r.code === 'not_found'
            ? 'not_found'
            : r.code === 'conflict'
              ? 'conflict'
              : 'validation_failed',
          r.code === 'not_found'
            ? 'Tema tidak ditemukan'
            : r.code === 'conflict'
              ? 'Slug sudah dipakai'
              : 'Tema belum memenuhi kontrak (L-5, L-8, L-21)',
          requestId,
          { errors: r.errors, contrast: r.contrast },
        );
      }
      await writeAudit(unsafeAcrossTenants(), {
        clientId: scope,
        actorId: a.user.id,
        action: 'theme.edit',
        resource: 'theme',
        resourceId: r.row.code,
        ip: clientIp(request, server),
        requestId,
      });
      emit('config.saved', { section: 'app', key: 'theme.custom', clientId: scope }, { requestId });
      return ok(viewCustomTheme(r.row));
    },
    {
      beforeHandle: permission('theme.manage'),
      params: t.Object({ id: Id }),
      body: CustomThemeBody,
      response: { 200: OkSchema(CustomThemeView), ...errorResponses },
      detail: { summary: 'Update a custom theme; live on every instance at the next request' },
    },
  )
  .delete(
    '/custom/:id',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const existing = await customThemes.byId(params.id);
      const scope = existing?.scope === GLOBAL ? null : (tenantState?.clientId ?? null);
      if (existing?.scope === GLOBAL && !a.user.is_superadmin) {
        set.status = 403;
        return fail('forbidden', 'Hanya superadmin yang boleh menghapus tema global', requestId);
      }
      if (!(await customThemes.remove(scope, params.id))) {
        set.status = 404;
        return fail('not_found', 'Tema tidak ditemukan', requestId);
      }
      await writeAudit(unsafeAcrossTenants(), {
        clientId: scope,
        actorId: a.user.id,
        action: 'theme.delete',
        resource: 'theme',
        resourceId: existing?.code ?? params.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({ deleted: true as const });
    },
    {
      beforeHandle: permission('theme.manage'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
      detail: {
        summary: 'Remove a custom theme; users on it fall back through the resolution chain (L-12)',
      },
    },
  );
