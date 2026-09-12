import { consumeRateLimit, rateLimitHeaders, writeAudit } from '@core/auth';
import { errorResponses, fail, OkSchema, ok } from '@core/contracts';
import { unsafeAcrossTenants } from '@core/db';
import { createSmtpTransport, formatFrom, sendTestEmail, smtpHints, tlsMode } from '@core/mail';
import { GLOBAL, maskChanges, webRoutes } from '@core/settings';
import { themes } from '@core/ui-theme';
import { Elysia, t } from 'elysia';
import { smtpFor } from '../mail.ts';
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
/** Extension point 6: a button the section offers beside "Save", rendered generically. */
const ActionInput = t.Object({
  key: t.String(),
  label: Localized,
  type: t.String(),
  placeholder: t.Nullable(Localized),
  max: t.Nullable(t.Number()),
  /** What the input starts with — the registry's own value, or one only the server can resolve. */
  default: t.String(),
});
const SectionAction = t.Object({
  key: t.String(),
  label: Localized,
  endpoint: t.String(),
  permission: t.Nullable(t.String()),
  note: t.Nullable(Localized),
  input: t.Nullable(ActionInput),
});
const Section = t.Object({
  section: t.String(),
  module: t.String(),
  title: Localized,
  note: t.Nullable(Localized),
  order: t.Integer(),
  actions: t.Array(SectionAction),
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
      const view = await settings.adminView(scope.clientId);
      // The mail tester opens with the SMTP account this scope actually sends as — which lives
      // in the settings OR in .env (J-1, E-6), so only `smtpFor()` can name it. Resolved once,
      // and only when the section that asks for it is on the page.
      const wantsSmtpAccount = view.some(
        (s) => s.section === 'mail' && s.actions.some((a) => a.input),
      );
      const smtpAccount = wantsSmtpAccount ? await smtpFor(scope.clientId) : null;
      const inputDefault = (section: string, declared: string) =>
        section === 'mail'
          ? smtpAccount?.user?.trim() || smtpAccount?.fromAddress || declared
          : declared;
      const sections: (typeof Section)['static'][] = view.map((s) => ({
        section: s.section,
        module: s.module,
        title: { ...s.title },
        note: s.note ? { ...s.note } : null,
        order: s.order,
        actions: s.actions.map((a) => ({
          key: a.key,
          label: { ...a.label },
          endpoint: a.endpoint,
          permission: a.permission,
          note: a.note ? { ...a.note } : null,
          input: a.input
            ? {
                key: a.input.key,
                label: { ...a.input.label },
                type: a.input.type,
                placeholder: a.input.placeholder ? { ...a.input.placeholder } : null,
                max: a.input.max,
                default: inputDefault(s.section, a.input.default),
              }
            : null,
        })),
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
      }));
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
  )
  /**
   * Send ONE test e-mail with the SMTP configuration of this scope — the `mail` section's action
   * (extension point 6). Straight through SMTP, never the outbox: the question is "do these
   * credentials work?", and an outbox row would answer it a minute later on another page. Two
   * steps like `bun run mail:test` — verify (connection, TLS, auth) then send — so a failure says
   * which half broke, with `smtpHints()` for what to try next. The configuration comes from
   * `smtpFor()`, exactly as a real delivery resolves it (setting, else .env), so testing the
   * global scope and a tenant that overrides it are two different answers, as they should be.
   */
  .post(
    '/mail/test',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = actor(auth);
      const scope = scopeOf(a, tenantState?.clientId ?? null, body.scope);
      if (!scope.ok) {
        set.status = 403;
        return fail(
          'forbidden',
          'Hanya superadmin yang boleh menguji konfigurasi global',
          requestId,
        );
      }
      const db = unsafeAcrossTenants();
      // This is the one admin button that sends mail to an address the caller types, so it gets
      // a budget of its own per account: enough for an afternoon of fixing SMTP, not a relay.
      const limit = await consumeRateLimit(db, `mailtest:user:${a.user.id}`, {
        limit: 10,
        windowSeconds: 600,
      });
      Object.assign(set.headers, rateLimitHeaders(limit));
      if (!limit.allowed) {
        set.status = 429;
        return fail('rate_limited', 'Terlalu banyak email uji — coba lagi nanti', requestId);
      }
      const smtp = await smtpFor(scope.clientId);
      if (!smtp) {
        // Nothing wrong with the request: this scope simply has no SMTP to test yet.
        return ok({
          ok: false,
          message: 'SMTP belum dikonfigurasi untuk lingkup ini',
          details: [
            'Minimal isi SMTP host dan Alamat pengirim di bagian ini, simpan, lalu uji lagi.',
            'Kosongkan keduanya untuk memakai SMTP_HOST / MAIL_FROM_ADDRESS dari .env.',
          ],
        });
      }
      const to = (body.to ?? '').trim() || smtp.user?.trim() || smtp.fromAddress;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        set.status = 422;
        return fail('validation_failed', 'Alamat tujuan tidak valid', requestId, {
          to: `bukan alamat email: "${to}"`,
        });
      }
      // What was tested, in the answer itself — the same lines whether it worked or not, because
      // "which configuration did I just test?" is the first question either way. No password.
      const context = [
        `${smtp.host}:${smtp.port} · ${tlsMode(smtp)}`,
        smtp.user ? `autentikasi: user "${smtp.user}"` : 'tanpa autentikasi',
        `dari ${formatFrom(smtp)} · ke ${to}`,
      ];
      const audit = (success: boolean, note: string) =>
        writeAudit(db, {
          clientId: scope.clientId,
          actorId: a.user.id,
          action: 'mail.test',
          resource: 'config',
          resourceId: scope.clientId ?? GLOBAL,
          ip: clientIp(request, server),
          requestId,
          after: { ok: success, to, host: smtp.host, port: smtp.port, note },
        });
      const transport = createSmtpTransport(smtp, { timeoutMs: 10_000 });
      const started = Date.now();
      let step = 'Koneksi/autentikasi';
      try {
        await transport.verify();
        step = 'Pengiriman';
        const r = await sendTestEmail(smtp, to, { transport, sentBy: 'Pengaturan → Email' });
        const ms = Date.now() - started;
        await audit(true, `terkirim dalam ${ms} ms`);
        return ok({
          ok: true,
          message: `Email uji terkirim ke ${to} (${ms} ms) — periksa kotak masuk, termasuk folder spam.`,
          details: [
            ...context,
            ...(r.messageId ? [`message-id ${r.messageId}`] : []),
            ...(r.rejected.length ? [`ditolak: ${r.rejected.join(', ')}`] : []),
            ...(r.response ? [`respons server: ${r.response}`] : []),
          ],
        });
      } catch (err) {
        const e = err as { code?: string; responseCode?: number; command?: string };
        const message = err instanceof Error ? err.message : String(err);
        const tag = [e.code, e.responseCode, e.command].filter(Boolean).join(' · ');
        await audit(false, `${step}: ${message}`.slice(0, 500));
        return ok({
          ok: false,
          message: `${step} gagal${tag ? ` [${tag}]` : ''}: ${message}`,
          details: [...context, ...smtpHints(err)],
        });
      } finally {
        transport.close();
      }
    },
    {
      beforeHandle: permission('config.edit'),
      body: t.Object({
        scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])),
        /** Empty = the SMTP account in effect, else the from-address. */
        to: t.Optional(t.String({ maxLength: 191 })),
      }),
      response: {
        200: OkSchema(
          t.Object({ ok: t.Boolean(), message: t.String(), details: t.Array(t.String()) }),
        ),
        ...errorResponses,
      },
      detail: {
        summary:
          "Send one test e-mail with this scope's SMTP settings, straight through SMTP (J-1, E-3)",
      },
    },
  );
