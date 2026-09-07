import { writeAudit } from '@core/auth';
import { errorResponses, fail, OkSchema, ok } from '@core/contracts';
import { unsafeAcrossTenants } from '@core/db';
import { GLOBAL, maskChanges, webRoutes } from '@core/settings';
import { themes } from '@core/ui-theme';
import { Elysia, t } from 'elysia';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';
import { customThemes, emit, settings } from '../services.ts';

/**
 * Runtime configuration (PRD FR-E, Decision I). Scope = the active tenant, or `global` when the
 * caller asks for it (superadmin only): tenant values override global, global overrides field
 * defaults (E-2). The form on the web is GENERATED from `GET /` (E-3); `PUT /` validates every
 * value against its type and the route/theme registries and bumps the cache version (E-5), so
 * every instance sees the change on its next request — no restart.
 */

const Localized = t.Object({ id: t.String(), en: t.String() });
const Field = t.Object({
  key: t.String(),
  type: t.String(),
  title: Localized,
  note: t.Nullable(Localized),
  options: t.Nullable(t.Array(t.Object({ value: t.String(), label: Localized }))),
  public: t.Boolean(),
  min: t.Nullable(t.Number()),
  max: t.Nullable(t.Number()),
  source: t.Union([t.Literal('tenant'), t.Literal('global'), t.Literal('default')]),
  value: t.Unknown(),
  secretSet: t.Nullable(t.Boolean()),
});
const Section = t.Object({
  section: t.String(),
  module: t.String(),
  title: Localized,
  note: t.Nullable(Localized),
  order: t.Integer(),
  fields: t.Array(Field),
});

function actor(auth: AuthState | null): AuthState {
  if (!auth) throw new Error('guard missing');
  return auth;
}

/** Which scope a request addresses: `?scope=global` needs superadmin; otherwise the active tenant. */
function scopeOf(auth: AuthState, clientId: string | null, wanted: string | undefined) {
  if (wanted === 'global')
    return auth.user.is_superadmin ? { clientId: null, ok: true } : { clientId: null, ok: false };
  return { clientId, ok: true };
}

export const configuration = new Elysia({
  name: 'configuration',
  prefix: '/configuration',
  tags: ['configuration'],
})
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/public',
    async ({ tenantState }) => ok(await settings.publicValues(tenantState?.clientId ?? null)),
    {
      response: { 200: OkSchema(t.Record(t.String(), t.Unknown())), ...errorResponses },
      detail: {
        summary: 'Public values for the active tenant (anonymous allowed; secrets never) — E-4',
      },
    },
  )
  .get(
    '/',
    async ({ auth, query, set, requestId, tenantState }) => {
      const a = actor(auth);
      const scope = scopeOf(a, tenantState?.clientId ?? null, query.scope);
      if (!scope.ok) {
        set.status = 403;
        return fail(
          'forbidden',
          'Hanya superadmin yang boleh melihat konfigurasi global',
          requestId,
        );
      }
      // The theme list fills `app.allowed_themes` / `theme` options at read time (registry, not stored).
      type Opt = { value: string; label: { id: string; en: string } };
      const custom = await customThemes.listFor(scope.clientId, { includeDisabled: true });
      const themeOptions: Opt[] = [
        ...themes().map((th) => ({ value: th.id, label: { ...th.name } })),
        ...custom.map((c) => ({
          value: c.code,
          label: { ...(c.name as { id: string; en: string }) },
        })),
      ];
      const sections: (typeof Section)['static'][] = (await settings.adminView(scope.clientId)).map(
        (s) => ({
          section: s.section,
          module: s.module,
          title: { ...s.title },
          note: s.note ? { ...s.note } : null,
          order: s.order,
          fields: s.fields.map((f) => {
            const options: Opt[] | null =
              f.key === 'app.allowed_themes' || f.type === 'theme'
                ? themeOptions
                : f.options
                  ? f.options.map((o) => ({ value: o.value, label: { ...o.label } }))
                  : null;
            return {
              key: f.key,
              type: f.type,
              title: { ...f.title },
              note: f.note ? { ...f.note } : null,
              options,
              public: f.public,
              min: f.min,
              max: f.max,
              source: f.source,
              value: f.value,
              secretSet: f.secretSet,
            };
          }),
        }),
      );
      return ok({ scope: scope.clientId ?? GLOBAL, sections, routes: [...webRoutes] });
    },
    {
      beforeHandle: permission('config.read'),
      query: t.Object({ scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])) }),
      response: {
        200: OkSchema(
          t.Object({ scope: t.String(), sections: t.Array(Section), routes: t.Array(t.String()) }),
        ),
        ...errorResponses,
      },
      detail: {
        summary:
          'Sections + fields + resolved values for one scope; the settings form is generated from this (E-3)',
      },
    },
  )
  .get(
    '/key/:key',
    async ({ auth, params, set, requestId, tenantState }) => {
      actor(auth);
      const all = await settings.resolveAll(tenantState?.clientId ?? null);
      const e = all.get(params.key);
      if (!e) {
        set.status = 404;
        return fail('not_found', 'Kunci konfigurasi tidak dikenal', requestId);
      }
      return ok({
        key: e.key,
        source: e.source,
        value: e.field.type === 'secret' ? null : e.value,
        secretSet: e.field.type === 'secret' ? e.value !== null && e.value !== '' : null,
      });
    },
    {
      beforeHandle: permission('config.read'),
      params: t.Object({ key: t.String({ maxLength: 191 }) }),
      response: {
        200: OkSchema(
          t.Object({
            key: t.String(),
            source: t.String(),
            value: t.Unknown(),
            secretSet: t.Nullable(t.Boolean()),
          }),
        ),
        ...errorResponses,
      },
      detail: { summary: 'One resolved value (secrets masked)' },
    },
  )
  .put(
    '/',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const scope = scopeOf(a, tenantState?.clientId ?? null, body.scope);
      if (!scope.ok) {
        set.status = 403;
        return fail(
          'forbidden',
          'Hanya superadmin yang boleh mengubah konfigurasi global',
          requestId,
        );
      }
      const entries = Object.entries(body.values).map(([key, value]) => ({ key, value }));
      const allowed = body.values['app.allowed_themes'];
      const result = await settings.save(scope.clientId, entries, {
        actorId: a.user.id,
        routes: webRoutes,
        ...(Array.isArray(allowed) ? { allowedThemes: allowed.map(String) } : {}),
      });
      if (Object.keys(result.errors).length) {
        set.status = 422;
        return fail('validation_failed', 'Ada nilai yang tidak valid', requestId, result.errors);
      }
      if (result.changed.length) {
        const db = unsafeAcrossTenants();
        await writeAudit(db, {
          clientId: scope.clientId,
          actorId: a.user.id,
          action: 'config.edit',
          resource: 'config',
          resourceId: scope.clientId ?? GLOBAL,
          ip: clientIp(request, server),
          requestId,
          before: Object.fromEntries(maskChanges(result.changed).map((c) => [c.key, c.before])),
          after: Object.fromEntries(maskChanges(result.changed).map((c) => [c.key, c.after])),
        });
        for (const c of result.changed) {
          emit(
            'config.saved',
            { section: c.key.split('.')[0] ?? '', key: c.key, clientId: scope.clientId },
            { requestId },
          );
        }
      }
      return ok({ scope: scope.clientId ?? GLOBAL, changed: result.changed.map((c) => c.key) });
    },
    {
      beforeHandle: permission('config.edit'),
      body: t.Object({
        scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])),
        values: t.Record(t.String({ maxLength: 191 }), t.Unknown()),
      }),
      response: {
        200: OkSchema(t.Object({ scope: t.String(), changed: t.Array(t.String()) })),
        ...errorResponses,
      },
      detail: {
        summary:
          'Save values for one scope; validated by type, audited, cache invalidated on every instance (E-5)',
      },
    },
  );
