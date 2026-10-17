import { consumeRateLimit, rateLimitHeaders, writeAudit } from '@core/auth';
import { errorResponses, fail, Id, OkSchema, ok } from '@core/contracts';
import { and, eq, inArray, isNull, schema, unsafeAcrossTenants } from '@core/db';
import {
  buildTestMessage,
  createSmtpTransport,
  engagementOf,
  formatFrom,
  newOpenToken,
  recordTestEmail,
  SMTP_TEST_TEMPLATE,
  sendTestEmail,
  smtpHints,
  tlsMode,
} from '@core/mail';
import {
  configFields,
  GLOBAL,
  maskChanges,
  notFoundRoutesForModules,
  publicRoutesForModules,
  routesForModules,
} from '@core/settings';
import { themes } from '@core/ui-theme';
import { Elysia, t } from 'elysia';
import { type FileRow, readFile } from '../files.ts';
import { publicOrigin, smtpFor } from '../mail.ts';
import { mqttFor, mqttState, testMqtt } from '../mqtt.ts';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';
import { customThemes, emit, moduleState, settings } from '../services.ts';

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
  /** Key of the section group the field is drawn under; null = before every group. */
  group: t.Nullable(t.String()),
  /** Layout hint for wide screens; the registry default is already applied. */
  width: t.Union([t.Literal('full'), t.Literal('half'), t.Literal('third')]),
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
/** A titled block inside a section's form — presentation only. */
const FieldGroup = t.Object({ key: t.String(), title: Localized, note: t.Nullable(Localized) });
const Section = t.Object({
  section: t.String(),
  module: t.String(),
  title: Localized,
  note: t.Nullable(Localized),
  order: t.Integer(),
  /** `global` = deployment-wide section, offered in the global scope only. */
  scope: t.Nullable(t.Literal('global')),
  groups: t.Array(FieldGroup),
  actions: t.Array(SectionAction),
  fields: t.Array(Field),
});

/** What an `image` setting may hold: rasters every browser and social network can show. */
const IMAGE_SETTING_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Keys of every registered `image` setting (core and modules). */
const imageKeys = () =>
  [...configFields().values()].filter((f) => f.type === 'image').map((f) => f.key);

/** A live, public raster file by id — the only kind of file an `image` setting may point at. */
async function imageFile(id: string): Promise<FileRow | null> {
  const [row] = await unsafeAcrossTenants() // a global setting may name a file of any tenant
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        eq(schema.files.visibility, 'public'),
        isNull(schema.files.deleted_at),
      ),
    )
    .limit(1);
  return row && IMAGE_SETTING_TYPES.has(row.mime) ? row : null;
}

const imageMeta = (row: FileRow) => {
  const meta = (row.meta ?? {}) as { width?: unknown; height?: unknown };
  const n = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
  return {
    url: `/v1/configuration/image-file/${row.id}`,
    width: n(meta.width),
    height: n(meta.height),
    mime: row.mime,
  };
};

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
        summary: 'Get public settings',
        description:
          'Public values for the active tenant. No session needed; secrets are never included.',
      },
    },
  )
  .get(
    '/image/:key',
    async ({ params, set, requestId, tenantState }) => {
      if (!imageKeys().includes(params.key)) {
        set.status = 404;
        return fail('not_found', 'Kunci gambar tidak dikenal', requestId);
      }
      // Same scope resolution as the public values: the tenant named by session / X-Client-ID,
      // else the global value an anonymous visitor reads.
      const id = await settings.get<string | null>(tenantState?.clientId ?? null, params.key);
      const row = typeof id === 'string' && id ? await imageFile(id) : null;
      return ok(row ? imageMeta(row) : null);
    },
    {
      params: t.Object({ key: t.String({ maxLength: 191 }) }),
      response: {
        200: OkSchema(
          t.Nullable(
            t.Object({
              url: t.String(),
              width: t.Nullable(t.Integer()),
              height: t.Nullable(t.Integer()),
              mime: t.String(),
            }),
          ),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Get an image setting',
        description:
          'Public. Where the image an `image` setting names can be fetched, with its pixel size — ' +
          'what share cards (og:image) need. Null when the setting is empty.',
      },
    },
  )
  .get(
    '/image-file/:id',
    async ({ params, set, requestId }) => {
      // Only a file some `image` setting currently names, in any scope, is served here: social
      // crawlers fetch it anonymously, without a tenant — and nothing else becomes reachable.
      const [named] = await unsafeAcrossTenants()
        .select({ key: schema.configurations.key })
        .from(schema.configurations)
        .where(
          and(
            inArray(schema.configurations.key, imageKeys()),
            eq(schema.configurations.value, params.id),
          ),
        )
        .limit(1);
      const row = named ? await imageFile(params.id) : null;
      const obj = row ? await readFile(row) : null;
      if (!row || !obj) {
        set.status = 404;
        return fail('not_found', 'Gambar tidak ditemukan', requestId);
      }
      return new Response(new Blob([obj.bytes as unknown as ArrayBuffer]), {
        headers: {
          'content-type': row.mime,
          'content-length': String(obj.bytes.byteLength),
          'x-content-type-options': 'nosniff',
          // Addressed by id: a new upload is a new URL, so this one may be cached for long.
          'cache-control': 'public, max-age=86400',
          'x-request-id': requestId,
        },
      });
    },
    {
      params: t.Object({ id: Id }),
      response: { 200: t.Unknown(), ...errorResponses },
      detail: {
        summary: 'Download an image setting',
        description:
          'Public. The bytes of an image an `image` setting currently names; anything else is 404.',
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
      // G-8: a module disabled for this scope (tenant override, else global) contributes no
      // section — the Settings page must not offer a form for something the tenant cannot use.
      // Its stored values stay untouched, so re-enabling brings the section back as it was.
      const enabledModules = await moduleState.enabledFor(scope.clientId);
      // Deployment-wide sections (`scope: 'global'`) have no tenant layer, so the tenant form does
      // not offer them — a value typed there would be refused on save and read by nobody.
      const view = (await settings.adminView(scope.clientId)).filter(
        (s) =>
          (s.module === 'core' || enabledModules.has(s.module)) &&
          (s.scope !== 'global' || scope.clientId === null),
      );
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
        scope: s.scope,
        groups: s.groups.map((g) => ({
          key: g.key,
          title: { ...g.title },
          note: g.note ? { ...g.note } : null,
        })),
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
            group: f.group,
            width: f.width,
            source: f.source,
            value: f.value,
            secretSet: f.secretSet,
          };
        }),
      }));
      // The `route` fields (landing, home) may only offer pages this scope can reach: a page of a
      // module disabled here would be refused on save and fall back at `/` anyway (§4.7, G-8).
      return ok({
        scope: scope.clientId ?? GLOBAL,
        sections,
        routes: routesForModules(enabledModules),
        publicRoutes: publicRoutesForModules(enabledModules),
        notFoundRoutes: notFoundRoutesForModules(enabledModules),
      });
    },
    {
      beforeHandle: permission('config.read'),
      query: t.Object({ scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])) }),
      response: {
        200: OkSchema(
          t.Object({
            scope: t.String(),
            sections: t.Array(Section),
            routes: t.Array(t.String()),
            publicRoutes: t.Array(t.String()),
            /** F-11: declared 404 handler pages with their module, for the `not_found_route` select. */
            notFoundRoutes: t.Array(t.Object({ path: t.String(), module: t.String() })),
          }),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Get settings',
        description: 'Sections, fields and resolved values for one scope.',
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
      detail: { summary: 'Get one setting', description: 'Secrets are masked.' },
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
      // An `image` setting must name a file that exists, is public and is a raster image — a
      // tenant may only point at its own files; the global scope at any (it serves everyone).
      const images = new Set(imageKeys());
      const badImages: Record<string, string> = {};
      for (const e of entries) {
        if (!images.has(e.key) || e.value === null || e.value === undefined || e.value === '')
          continue;
        const row = await imageFile(String(e.value).trim().toLowerCase());
        if (!row || (scope.clientId !== null && row.client_id !== scope.clientId))
          badImages[e.key] =
            'berkas gambar tidak ditemukan, tidak publik, atau bukan JPEG/PNG/WebP/GIF';
      }
      if (Object.keys(badImages).length) {
        set.status = 422;
        return fail('validation_failed', 'Ada nilai yang tidak valid', requestId, badImages);
      }
      const allowed = body.values['app.allowed_themes'];
      const enabled = await moduleState.enabledFor(scope.clientId);
      const result = await settings.save(scope.clientId, entries, {
        actorId: a.user.id,
        // The same two lists the form was generated from: a disabled module's page is not a valid
        // route here, and a page behind the sign-in wall is not a valid landing page.
        routes: routesForModules(enabled),
        publicRoutes: publicRoutesForModules(enabled),
        notFoundRoutes: notFoundRoutesForModules(enabled).map((r) => r.path),
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
        summary: 'Save settings',
        description: 'Validated by type and audited. Takes effect on every instance.',
      },
    },
  )
  /**
   * Send ONE test e-mail with the SMTP configuration of this scope — the `mail` section's action
   * (extension point 6). Straight through SMTP, never queued: the question is "do these
   * credentials work?", and a queued row would answer it a minute later on another page. Two
   * steps like `bun run mail:test` — verify (connection, TLS, auth) then send — so a failure says
   * which half broke, with `smtpHints()` for what to try next. The configuration comes from
   * `smtpFor()`, exactly as a real delivery resolves it (setting, else .env), so testing the
   * global scope and a tenant that overrides it are two different answers, as they should be.
   * The outcome is then RECORDED in the outbox (`smtp-test`, sent or failed) so the test sits in
   * the same history as real mail and can be sent again from `/outbox`.
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
      // Built before sending so the outbox row is titled with the real subject either way.
      const sentBy = 'Pengaturan → Email';
      // J-6: the test mail carries the pixel and the tracked button when this scope tracks
      // opens — it is the mail an admin opens to see tracking work, so it must be the first one
      // that is tracked. The "I received this" button is there either way: confirming receipt is
      // a deliberate act by the reader, not passive tracking, and it is what the tester waits for.
      const tracked =
        (await settings.get<boolean | null>(scope.clientId, 'mail.track_opens')) === true;
      const openToken = newOpenToken();
      const origin = publicOrigin(request);
      const confirmUrl = `${origin}/auth/mail-received/${openToken}`;
      const message = buildTestMessage(smtp, to, {
        sentBy,
        confirmUrl,
        ...(tracked
          ? {
              pixelUrl: `${origin}/v1/mail/o/${openToken}.gif`,
              buttonUrl: `${origin}/v1/mail/c/${openToken}`,
            }
          : {}),
      });
      const record = (error: string | null) =>
        recordTestEmail(db, {
          to,
          subject: message.subject,
          clientId: scope.clientId,
          sentBy,
          error,
          openToken,
          link: confirmUrl,
        });
      const started = Date.now();
      let step = 'Koneksi/autentikasi';
      try {
        await transport.verify();
        step = 'Pengiriman';
        const r = await sendTestEmail(smtp, to, { transport, message });
        const ms = Date.now() - started;
        await audit(true, `terkirim dalam ${ms} ms`);
        const outboxId = await record(null);
        return ok({
          ok: true,
          message: `Email uji terkirim ke ${to} (${ms} ms) — periksa kotak masuk, termasuk folder spam.`,
          details: [
            ...context,
            ...(smtp.bcc ? [`bcc ${smtp.bcc}`] : []),
            ...(tracked ? ['pelacakan buka aktif — pixel disertakan'] : []),
            ...(r.messageId ? [`message-id ${r.messageId}`] : []),
            ...(r.rejected.length ? [`ditolak: ${r.rejected.join(', ')}`] : []),
            ...(r.response ? [`respons server: ${r.response}`] : []),
            'tercatat di Outbox',
          ],
          // The page follows this row: opened, clicked, confirmed — while the operator waits.
          engagement: { id: outboxId },
        });
      } catch (err) {
        const e = err as { code?: string; responseCode?: number; command?: string };
        const message = err instanceof Error ? err.message : String(err);
        const tag = [e.code, e.responseCode, e.command].filter(Boolean).join(' · ');
        await audit(false, `${step}: ${message}`.slice(0, 500));
        await record(`${step}: ${message}`);
        return ok({
          ok: false,
          message: `${step} gagal${tag ? ` [${tag}]` : ''}: ${message}`,
          details: [...context, ...smtpHints(err), 'tercatat di Outbox'],
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
          t.Object({
            ok: t.Boolean(),
            message: t.String(),
            details: t.Array(t.String()),
            /** The outbox row of a delivered test, to follow with `GET /mail/test/:id`. */
            engagement: t.Optional(t.Object({ id: t.String() })),
          }),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Send a test email',
        description:
          'Sends straight through the SMTP settings of this scope, bypassing the outbox queue.',
      },
    },
  )
  /**
   * What became of one test e-mail after it left: opened (pixel), clicked (tracked button),
   * confirmed (the recipient pressed "received" on the page the mail links to). The Settings
   * page polls this under the tester's verdict. Only `smtp-test` rows of the caller's scope are
   * visible here — the outbox itself has its own, wider permission.
   */
  .get(
    '/mail/test/:id',
    async ({ auth, params, query, set, requestId, tenantState }) => {
      const scope = scopeOf(actor(auth), tenantState?.clientId ?? null, query.scope);
      if (!scope.ok) {
        set.status = 403;
        return fail('forbidden', 'Hanya superadmin yang boleh melihat uji global', requestId);
      }
      const e = await engagementOf(unsafeAcrossTenants(), params.id, {
        template: SMTP_TEST_TEMPLATE,
        clientId: scope.clientId,
      });
      if (!e) {
        set.status = 404;
        return fail('not_found', 'Email uji tidak ditemukan', requestId);
      }
      return ok(e);
    },
    {
      beforeHandle: permission('config.edit'),
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
      query: t.Object({
        scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])),
      }),
      response: {
        200: OkSchema(
          t.Object({
            status: t.String(),
            sentAt: t.Nullable(t.String()),
            openedAt: t.Nullable(t.String()),
            openCount: t.Integer(),
            clickedAt: t.Nullable(t.String()),
            actedAt: t.Nullable(t.String()),
          }),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Get test email engagement',
        description:
          'Delivery status and whether the test email was opened, its button clicked, and its receipt confirmed.',
      },
    },
  )
  /**
   * Settings → MQTT → "Test connection" (extension point 6). The section is deployment-wide, so
   * this always tests the GLOBAL configuration — the same resolution the running client uses
   * (setting, else `MQTT_*` from .env) — whatever scope the page was opened in. One round trip
   * through a probe topic, with the broker named in the answer either way.
   */
  .post(
    '/mqtt/test',
    async ({ auth, set, request, server, requestId }) => {
      const a = actor(auth);
      const db = unsafeAcrossTenants();
      const limit = await consumeRateLimit(db, `mqtttest:user:${a.user.id}`, {
        limit: 20,
        windowSeconds: 600,
      });
      Object.assign(set.headers, rateLimitHeaders(limit));
      if (!limit.allowed) {
        set.status = 429;
        return fail('rate_limited', 'Terlalu banyak uji koneksi — coba lagi nanti', requestId);
      }
      const resolved = await mqttFor();
      if (!resolved.config) {
        return ok({
          ok: false,
          message: resolved.problem ?? 'Broker MQTT belum dikonfigurasi',
          details: [
            'Isi URL broker di bagian ini (lingkup global), simpan, lalu uji lagi.',
            'Atau kosongkan dan isi MQTT_URL / MQTT_USERNAME / MQTT_PASSWORD di .env.',
          ],
        });
      }
      const r = await testMqtt(resolved.config);
      const live = mqttState();
      await writeAudit(db, {
        clientId: null,
        actorId: a.user.id,
        action: 'mqtt.test',
        resource: 'config',
        resourceId: GLOBAL,
        ip: clientIp(request, server),
        requestId,
        after: { ok: r.ok, url: resolved.config.url, source: resolved.config.source },
      });
      return ok({
        ok: r.ok,
        message: r.message,
        details: [
          ...r.details,
          resolved.enabled
            ? live.connected
              ? `klien instance ini tersambung (${live.subscriptions.length} langganan modul)`
              : `klien instance ini aktif tetapi belum tersambung${live.lastError ? ` — ${live.lastError}` : ''}`
            : 'klien belum diaktifkan — nyalakan "Aktifkan klien MQTT" lalu simpan',
        ],
      });
    },
    {
      beforeHandle: permission('config.edit'),
      body: t.Object({ scope: t.Optional(t.String()) }),
      response: {
        200: OkSchema(
          t.Object({ ok: t.Boolean(), message: t.String(), details: t.Array(t.String()) }),
        ),
        ...errorResponses,
      },
      detail: {
        summary: 'Test the MQTT broker',
        description:
          'Connects to the broker the global settings resolve to (settings, else MQTT_* from .env), ' +
          'subscribes to a probe topic, publishes to it and waits for the echo. Rate limited per account.',
      },
    },
  );
