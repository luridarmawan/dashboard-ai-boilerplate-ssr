import {
  consumeRateLimit,
  hashPassword,
  hashToken,
  parseRateLimitRule,
  passwordProblems,
  randomToken,
  rateLimitHeaders,
  writeAudit,
} from '@core/auth';
import { env } from '@core/config';
import { Email, errorResponses, fail, OkSchema, ok, Password } from '@core/contracts';
import { and, eq, inArray, isNull, newId, schema, unsafeAcrossTenants } from '@core/db';
import { Elysia, t } from 'elysia';
import { Id, notFound } from '../lib/http.ts';
import { mailLocale, publicLink, sendTemplate } from '../mail.ts';
import { type AuthState, authContext, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';
import { emit, settings } from '../services.ts';
import { issueSession, PublicUser } from './auth.ts';

/**
 * Registration by invitation link (PRD A-13).
 *
 *   Admin side (`/v1/invitations`, permission `user.create`, tenant-scoped): invite an e-mail
 *   address into the ACTIVE tenant. Unknown address → an `invitations` row + an e-mail with
 *   `<origin>/join/<code>`; the code is returned once so the admin can also hand it over by other
 *   means. Address already registered → no invitation: the user is added to the tenant and gets an
 *   e-mail saying to sign in (A-13: "kirimkan informasi untuk login"). Pending invitations can be
 *   listed and revoked; re-inviting an address revokes its pending invitation.
 *
 *   Every invitation names the GROUP the invitee joins (owner's ask of 2026-09-24): `groupId` in
 *   the body, a live group of the active tenant; omitted → the tenant's `user` (Regular User)
 *   group; `null` → no group. An already registered address is added to that group right away, a
 *   new one on acceptance (`/v1/auth/join`), the same way `POST /v1/users` grants `groupIds`.
 *
 *   Public side (`/v1/auth/join`): the invitee sees whom the link is for and registers with a
 *   name and password — REGARDLESS of SIGNUP_ENABLED, which governs self-service sign-up only.
 *   The e-mail counts as verified (they received the link there). Validity comes from
 *   `security.invitation_hours` (default 72 h) at creation time.
 */

const DEFAULT_HOURS = 72;
/** Code of the seeded group a plain invitation lands in (`SYSTEM_GROUPS` in `@core/auth`). */
const DEFAULT_GROUP_CODE = 'user';
const CODE = t.String({ minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' });

type InvitationRow = typeof schema.invitations.$inferSelect;
type GroupRef = { id: string; name: string };

const GroupRefSchema = t.Object({ id: t.String(), name: t.String() });
const InvitationView = t.Object({
  id: t.String(),
  email: t.String(),
  status: t.Union([t.Literal('pending'), t.Literal('expired')]),
  expiresAt: t.String(),
  createdAt: t.String(),
  invitedBy: t.Nullable(t.String()),
  group: t.Nullable(GroupRefSchema),
});

function view(r: InvitationRow, inviter: string | null, group: GroupRef | null) {
  return {
    id: r.id,
    email: r.email,
    status: r.expires_at.getTime() < Date.now() ? ('expired' as const) : ('pending' as const),
    expiresAt: r.expires_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    invitedBy: inviter,
    group,
  };
}

/** Live groups of `clientId` by id — for the list view and for the group an invitation names. */
async function liveGroups(clientId: string, ids: string[]): Promise<Map<string, GroupRef>> {
  const out = new Map<string, GroupRef>();
  const wanted = [...new Set(ids)];
  if (!wanted.length) return out;
  const rows = await unsafeAcrossTenants()
    .select({ id: schema.groups.id, name: schema.groups.name })
    .from(schema.groups)
    .where(
      and(
        eq(schema.groups.client_id, clientId),
        inArray(schema.groups.id, wanted),
        isNull(schema.groups.deleted_at),
      ),
    );
  for (const g of rows) out.set(g.id, g);
  return out;
}

/**
 * The group an invitation grants, from the body: omitted → the tenant's Regular User group (null
 * when a tenant has none), `null` → none, an id → that group or `'unknown'` when it is not a live
 * group of this tenant.
 */
async function invitedGroup(
  clientId: string,
  groupId: string | null | undefined,
): Promise<GroupRef | null | 'unknown'> {
  const db = unsafeAcrossTenants();
  if (groupId === null) return null;
  if (groupId === undefined) {
    const [g] = await db
      .select({ id: schema.groups.id, name: schema.groups.name })
      .from(schema.groups)
      .where(
        and(
          eq(schema.groups.client_id, clientId),
          eq(schema.groups.code, DEFAULT_GROUP_CODE),
          isNull(schema.groups.deleted_at),
        ),
      )
      .limit(1);
    return g ?? null;
  }
  return (await liveGroups(clientId, [groupId])).get(groupId) ?? 'unknown';
}

/** Add `userId` to `groupId` in `clientId` unless already a member — never removes anything. */
async function grantGroup(clientId: string, userId: string, groupId: string): Promise<boolean> {
  const db = unsafeAcrossTenants();
  const [has] = await db
    .select({ id: schema.groupUserMaps.id })
    .from(schema.groupUserMaps)
    .where(
      and(
        eq(schema.groupUserMaps.client_id, clientId),
        eq(schema.groupUserMaps.group_id, groupId),
        eq(schema.groupUserMaps.user_id, userId),
      ),
    )
    .limit(1);
  if (has) return false;
  await db.insert(schema.groupUserMaps).values({
    id: newId(),
    client_id: clientId,
    group_id: groupId,
    user_id: userId,
  });
  return true;
}

async function tenantName(clientId: string): Promise<string> {
  const [row] = await unsafeAcrossTenants()
    .select({ name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  return row?.name ?? '';
}

async function hoursFor(clientId: string | null): Promise<number> {
  const v = await settings.get<number | null>(clientId, 'security.invitation_hours');
  return typeof v === 'number' && v >= 1 ? v : DEFAULT_HOURS;
}

/** The invitation a code points at, with the reason it cannot be used (null = usable). */
async function resolveCode(code: string): Promise<{
  row: InvitationRow | null;
  problem: 'unknown' | 'expired' | 'used' | null;
}> {
  const db = unsafeAcrossTenants();
  const [row] = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.token_hash, hashToken(code)))
    .limit(1);
  if (!row) return { row: null, problem: 'unknown' };
  if (row.revoked_at) return { row, problem: 'unknown' };
  if (row.accepted_at) return { row, problem: 'used' };
  if (row.expires_at.getTime() < Date.now()) return { row, problem: 'expired' };
  return { row, problem: null };
}

function refuseCode(
  set: { status?: number | string },
  requestId: string,
  problem: 'unknown' | 'expired' | 'used',
) {
  if (problem === 'expired') {
    set.status = 410;
    return fail('token_expired', 'Tautan undangan sudah kedaluwarsa', requestId);
  }
  set.status = problem === 'used' ? 410 : 404;
  return fail(
    'token_invalid',
    problem === 'used'
      ? 'Tautan undangan ini sudah dipakai — masuk dengan akun Anda'
      : 'Tautan undangan tidak dikenal atau sudah dicabut',
    requestId,
  );
}

// ---- admin: invite, list, revoke -----------------------------------------------------------------
export const invitationsDomain = new Elysia({
  name: 'invitations',
  prefix: '/invitations',
  tags: ['invitations'],
})
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ tenantState }) => {
      const clientId = tenantState?.clientId;
      if (!clientId) return ok([]);
      const db = unsafeAcrossTenants();
      // Global table with an explicit client_id (see the schema): scope by hand, always.
      const rows = await db
        .select()
        .from(schema.invitations)
        .where(
          and(
            eq(schema.invitations.client_id, clientId),
            isNull(schema.invitations.accepted_at),
            isNull(schema.invitations.revoked_at),
          ),
        );
      const inviterIds = [...new Set(rows.map((r) => r.invited_by).filter(Boolean))] as string[];
      const inviters = new Map<string, string>();
      for (const id of inviterIds) {
        const [u] = await db
          .select({ name: schema.users.name })
          .from(schema.users)
          .where(eq(schema.users.id, id))
          .limit(1);
        if (u) inviters.set(id, u.name);
      }
      const groups = await liveGroups(
        clientId,
        rows.map((r) => r.group_id).filter((g): g is string => !!g),
      );
      return ok(
        rows
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
          .map((r) =>
            view(
              r,
              r.invited_by ? (inviters.get(r.invited_by) ?? null) : null,
              r.group_id ? (groups.get(r.group_id) ?? null) : null,
            ),
          ),
      );
    },
    {
      beforeHandle: permission('user.create'),
      response: { 200: OkSchema(t.Array(InvitationView)), ...errorResponses },
      detail: { summary: 'Pending invitations into the active tenant (A-13)' },
    },
  )
  .post(
    '/',
    async ({ auth, body, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const tenant = tenantState?.tenant;
      const clientId = tenantState?.clientId ?? null;
      if (!tenant || !clientId) {
        set.status = 409;
        return fail('conflict', 'Tidak ada tenant aktif', requestId);
      }
      const db = unsafeAcrossTenants();
      const email = body.email.trim().toLowerCase();
      // The invitee's own preference wins where there is one (`existing.locale` below); this is
      // for the rest: what the inviter picked, else the language they are inviting in.
      const locale = body.locale ?? (await mailLocale({ request, clientId }));
      const ip = clientIp(request, server);
      const group = await invitedGroup(clientId, body.groupId);
      if (group === 'unknown') {
        set.status = 422;
        return fail('validation_failed', 'Grup tidak ditemukan di tenant ini', requestId);
      }
      const tenantLabel = await tenantName(clientId);

      // Already registered (including soft-deleted): add to this tenant and say so by e-mail.
      // Soft-deleted accounts are revived so the invite can be fulfilled (otherwise the
      // invitation would be created for a taken e-mail and the subsequent /join would 409).
      const [existing] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (existing) {
        if (existing.deleted_at) {
          await db
            .update(schema.users)
            .set({ deleted_at: null })
            .where(eq(schema.users.id, existing.id));
          existing.deleted_at = null;
        }
        const membership = await tenant.selectOne(
          schema.clientUserMaps,
          eq(schema.clientUserMaps.user_id, existing.id),
        );
        if (!membership) {
          await tenant.insert(schema.clientUserMaps, {
            id: newId(),
            user_id: existing.id,
            is_default: false,
          });
        } else if (membership.deleted_at) {
          await tenant.update(
            schema.clientUserMaps,
            { deleted_at: null },
            eq(schema.clientUserMaps.id, membership.id),
          );
        }
        // Already a member: the invitation only adds the group, existing memberships stay.
        const granted = group ? await grantGroup(clientId, existing.id, group.id) : false;
        await sendTemplate(db, {
          to: email,
          toName: existing.name,
          template: 'invite-existing',
          locale: existing.locale ?? locale,
          clientId,
          data: {
            name: existing.name,
            inviter: a.user.name,
            tenant: tenantLabel,
            link: publicLink('/auth/login', request),
          },
        });
        await writeAudit(db, {
          clientId,
          actorId: a.user.id,
          action: 'invitation.existing',
          resource: 'user',
          resourceId: existing.id,
          ip,
          requestId,
          after: {
            email,
            added: !membership || !!membership.deleted_at,
            groupId: group?.id ?? null,
            groupGranted: granted,
          },
        });
        return ok({ existing: true as const, userId: existing.id, email, group });
      }

      // New address: one pending invitation per address — the previous one is revoked.
      const now = new Date();
      await db
        .update(schema.invitations)
        .set({ revoked_at: now })
        .where(
          and(
            eq(schema.invitations.client_id, clientId),
            eq(schema.invitations.email, email),
            isNull(schema.invitations.accepted_at),
            isNull(schema.invitations.revoked_at),
          ),
        );
      const hours = await hoursFor(clientId);
      const code = randomToken();
      const id = newId();
      await db.insert(schema.invitations).values({
        id,
        client_id: clientId,
        email,
        token_hash: hashToken(code),
        invited_by: a.user.id,
        group_id: group?.id ?? null,
        expires_at: new Date(now.getTime() + hours * 3600_000),
      });
      const [row] = (await db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, id))
        .limit(1)) as InvitationRow[];
      if (!row) throw new Error('invitation row vanished after insert');
      const link = publicLink(`/join/${code}`, request);
      await sendTemplate(db, {
        to: email,
        template: 'invite',
        locale,
        clientId,
        data: {
          name: email.split('@')[0] ?? email,
          inviter: a.user.name,
          tenant: tenantLabel,
          hours,
          link,
        },
      });
      await writeAudit(db, {
        clientId,
        actorId: a.user.id,
        action: 'invitation.create',
        resource: 'invitation',
        resourceId: id,
        ip,
        requestId,
        after: { email, expiresAt: row.expires_at.toISOString(), groupId: group?.id ?? null },
      });
      set.status = 201;
      // The code leaves the server exactly once, for admins who hand the link over themselves.
      return ok({ existing: false as const, ...view(row, a.user.name, group), link });
    },
    {
      beforeHandle: permission('user.create'),
      body: t.Object({
        email: Email,
        locale: t.Optional(t.Union([t.Literal('id'), t.Literal('en')])),
        // Omitted → the tenant's Regular User group; null → no group; id → a group of this tenant.
        groupId: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 36 }))),
      }),
      response: {
        200: OkSchema(
          t.Object({
            existing: t.Literal(true),
            userId: t.String(),
            email: t.String(),
            group: t.Nullable(GroupRefSchema),
          }),
        ),
        201: OkSchema(
          t.Intersect([t.Object({ existing: t.Literal(false), link: t.String() }), InvitationView]),
        ),
        ...errorResponses,
      },
      detail: {
        summary:
          'Invite an e-mail into the active tenant (A-13): new address → invitation link by e-mail (returned once); known address → added to the tenant and told to sign in. groupId = the group they join (default: Regular User)',
      },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set, request, server, requestId, tenantState }) => {
      const a = auth as AuthState;
      const clientId = tenantState?.clientId;
      if (!clientId) return notFound(set, requestId, 'Undangan');
      const db = unsafeAcrossTenants();
      const [target] = await db
        .select({ id: schema.invitations.id })
        .from(schema.invitations)
        .where(
          and(
            eq(schema.invitations.id, params.id),
            eq(schema.invitations.client_id, clientId),
            isNull(schema.invitations.accepted_at),
            isNull(schema.invitations.revoked_at),
          ),
        )
        .limit(1);
      if (!target) return notFound(set, requestId, 'Undangan');
      await db
        .update(schema.invitations)
        .set({ revoked_at: new Date() })
        .where(eq(schema.invitations.id, target.id));
      await writeAudit(db, {
        clientId,
        actorId: a.user.id,
        action: 'invitation.revoke',
        resource: 'invitation',
        resourceId: params.id,
        ip: clientIp(request, server),
        requestId,
      });
      return ok({ revoked: true });
    },
    {
      beforeHandle: permission('user.create'),
      params: t.Object({ id: Id }),
      response: { 200: OkSchema(t.Object({ revoked: t.Boolean() })), ...errorResponses },
      detail: { summary: 'Revoke a pending invitation' },
    },
  );

// ---- public: look at a code, register with it ------------------------------------------------------
export const joinDomain = new Elysia({ name: 'join', prefix: '/auth', tags: ['auth'] })
  .use(requestContext)
  .use(authContext)
  .get(
    '/join/:code',
    async ({ params, set, requestId }) => {
      const { row, problem } = await resolveCode(params.code);
      if (problem || !row) return refuseCode(set, requestId, problem ?? 'unknown');
      return ok({
        email: row.email,
        tenant: { id: row.client_id, name: await tenantName(row.client_id) },
        expiresAt: row.expires_at.toISOString(),
      });
    },
    {
      params: t.Object({ code: CODE }),
      response: {
        200: OkSchema(
          t.Object({
            email: t.String(),
            tenant: t.Object({ id: t.String(), name: t.String() }),
            expiresAt: t.String(),
          }),
        ),
        ...errorResponses,
      },
      detail: { summary: 'Whom an invitation code is for (A-13); 404/410 when unusable' },
    },
  )
  .post(
    '/join',
    async ({ body, set, request, server, requestId, cookie }) => {
      const e = env();
      const db = unsafeAcrossTenants();
      const ip = clientIp(request, server) ?? 'unknown';
      // Same budget as password logins, on its own counter (A-2).
      const rule = parseRateLimitRule(
        (await settings.get<string | null>(null, 'security.login_rate_limit')) ??
          e.LOGIN_RATE_LIMIT,
      );
      const limit = await consumeRateLimit(db, `join:ip:${ip}`, rule);
      Object.assign(set.headers, rateLimitHeaders(limit));
      if (!limit.allowed) {
        set.status = 429;
        return fail('rate_limited', 'Terlalu banyak percobaan — coba lagi nanti', requestId);
      }
      const { row, problem } = await resolveCode(body.code);
      if (problem || !row) return refuseCode(set, requestId, problem ?? 'unknown');
      const problems = passwordProblems(body.password);
      if (problems.length) {
        set.status = 422;
        return fail('weak_password', 'Kata sandi terlalu lemah', requestId, problems);
      }
      const [taken] = await db
        .select({ id: schema.users.id, deleted_at: schema.users.deleted_at })
        .from(schema.users)
        .where(eq(schema.users.email, row.email))
        .limit(1);
      if (taken && !taken.deleted_at) {
        set.status = 409;
        return fail('email_taken', 'Email ini sudah terdaftar — masuk dengan akun Anda', requestId);
      }
      const now = new Date();
      let userId: string;
      if (taken?.deleted_at) {
        // Soft-deleted account: revive it with the new credentials (otherwise the UNIQUE on
        // email would block the insert and the invitation would be stuck).
        userId = taken.id;
        await db
          .update(schema.users)
          .set({
            deleted_at: null,
            name: body.name.trim(),
            password_hash: await hashPassword(body.password),
            email_verified_at: now,
          })
          .where(eq(schema.users.id, userId));
        // Restore or create the tenant membership for the inviting tenant.
        const [existingMap] = await db
          .select({ id: schema.clientUserMaps.id, deleted_at: schema.clientUserMaps.deleted_at })
          .from(schema.clientUserMaps)
          .where(
            and(
              eq(schema.clientUserMaps.client_id, row.client_id),
              eq(schema.clientUserMaps.user_id, userId),
            ),
          )
          .limit(1);
        if (existingMap) {
          if (existingMap.deleted_at) {
            await db
              .update(schema.clientUserMaps)
              .set({ deleted_at: null })
              .where(eq(schema.clientUserMaps.id, existingMap.id));
          }
        } else {
          await db.insert(schema.clientUserMaps).values({
            id: newId(),
            client_id: row.client_id,
            user_id: userId,
            is_default: true,
          });
        }
      } else {
        userId = newId();
        await db.insert(schema.users).values({
          id: userId,
          email: row.email,
          name: body.name.trim(),
          password_hash: await hashPassword(body.password),
          // The link reached this very mailbox: the address is verified (A-6).
          email_verified_at: now,
        });
        await db.insert(schema.clientUserMaps).values({
          id: newId(),
          client_id: row.client_id,
          user_id: userId,
          is_default: true,
        });
      }
      // The group the admin picked, if it still exists (a deleted group nulls the column).
      const group = row.group_id
        ? ((await liveGroups(row.client_id, [row.group_id])).get(row.group_id) ?? null)
        : null;
      if (group) await grantGroup(row.client_id, userId, group.id);
      await db
        .update(schema.invitations)
        .set({ accepted_at: now, accepted_user_id: userId })
        .where(eq(schema.invitations.id, row.id));
      emit('user.created', { userId, clientId: row.client_id }, { requestId });
      await writeAudit(db, {
        clientId: row.client_id,
        actorId: userId,
        action: 'auth.join',
        resource: 'user',
        resourceId: userId,
        ip,
        requestId,
        after: { invitation: row.id, invitedBy: row.invited_by, groupId: group?.id ?? null },
      });
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      set.status = 201;
      return ok(
        await issueSession({
          db,
          user: user as NonNullable<typeof user>,
          ip,
          request,
          cookie,
          requestId,
        }),
      );
    },
    {
      body: t.Object({
        code: CODE,
        name: t.String({ minLength: 1, maxLength: 191 }),
        password: Password,
      }),
      response: {
        201: OkSchema(t.Object({ user: PublicUser, clientId: t.Nullable(t.String()) })),
        ...errorResponses,
      },
      detail: {
        summary:
          'Register through an invitation code (A-13): works with SIGNUP_ENABLED=false; joins the inviting tenant; sets the session cookie',
      },
    },
  );
