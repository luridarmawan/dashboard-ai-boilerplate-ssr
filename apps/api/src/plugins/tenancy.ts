import { canActInTenant, effectivePermissions, hasPermission } from '@core/auth';
import { fail } from '@core/contracts';
import { forTenant, newId, type TenantDb, unsafeAcrossTenants } from '@core/db';
import { Elysia } from 'elysia';
import { authContext } from './auth.ts';

/**
 * Tenant resolution and permission enforcement (PRD B-2, B-3, B-4, C-3, C-5, C-7).
 *
 * Active tenant, per request:
 *   1. `X-Client-ID` header, if present — it MUST name a tenant the user is a member of
 *      (`client_user_maps`; any live tenant for a superadmin, C-5), otherwise 403
 *      `tenant_forbidden`. A guess is never honoured.
 *   2. otherwise the session's stored tenant (set at login / by `switch-tenant`).
 *
 * The handler receives `tenant` (the data-layer facade bound to that tenant) and `perms`
 * (effective permissions, read from the DB on every request — no per-process cache, so a
 * change lands on the next request on every instance). `requirePermission('user.edit')`
 * guards a route; superadmin passes everything (C-5).
 *
 * Registered globally so module routes see `tenantState` too; the cost is paid only for
 * requests that carry a session, and only for non-superadmins (a few indexed reads).
 */

export const TENANT_HEADER = 'x-client-id';

export interface TenantState {
  /** Active tenant id; null when the user has none yet (B-2 — a fresh install before seed). */
  readonly clientId: string | null;
  /** Facade over the active tenant; null without one. Domain code queries through this (B-3). */
  readonly tenant: TenantDb | null;
  readonly perms: readonly string[];
  readonly can: (permission: string) => boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const tenantContext = new Elysia({ name: 'tenant-context' })
  .use(authContext)
  .resolve({ as: 'global' }, async ({ auth, request, set }) => {
    const empty: TenantState = { clientId: null, tenant: null, perms: [], can: () => false };
    if (!auth) return { tenantState: empty };

    const db = unsafeAcrossTenants(); // membership + permissions are read across tenants by definition
    const requested = request.headers.get(TENANT_HEADER)?.trim().toLowerCase() || null;
    let clientId = auth.clientId;
    if (requested) {
      if (!UUID_RE.test(requested) || !(await canActInTenant(db, auth.user, requested))) {
        set.status = 403;
        const rid = String(
          set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId(),
        );
        // Returning here short-circuits the request with the failure envelope (403).
        return {
          tenantState: empty,
          tenantRejection: fail('tenant_forbidden', 'Anda bukan anggota tenant yang diminta', rid),
        };
      }
      clientId = requested;
    }
    const perms = await effectivePermissions(db, auth.user, clientId);
    const state: TenantState = {
      clientId,
      tenant: clientId ? forTenant(clientId) : null,
      perms,
      can: (p) => auth.user.is_superadmin || hasPermission(perms, p),
    };
    return { tenantState: state, tenantRejection: null as ReturnType<typeof fail> | null };
  })
  .onBeforeHandle({ as: 'global' }, ({ tenantRejection }) => {
    if (tenantRejection) return tenantRejection;
  });

/** Route guard: 401 without a session, 403 `forbidden` without the permission (C-3, D3). */
export function requirePermission(permission: string) {
  return new Elysia({ name: `require:${permission}` })
    .use(tenantContext)
    .onBeforeHandle({ as: 'scoped' }, ({ auth, tenantState, tenantRejection, set, request }) => {
      if (tenantRejection) return tenantRejection;
      const rid = String(
        set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId(),
      );
      if (!auth) {
        set.status = 401;
        return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', rid);
      }
      if (!tenantState?.can(permission)) {
        set.status = 403;
        return fail('forbidden', `Anda tidak punya izin ${permission}`, rid, { permission });
      }
    });
}

interface GuardCtx {
  auth: { user: { is_superadmin: boolean } } | null;
  tenantState?: TenantState;
  set: { status?: number | string; headers: Record<string, string | number | undefined> };
  request: Request;
}

/**
 * Route-local form of the guard, for `beforeHandle` on ONE route when sibling routes need
 * different permissions (a plugin-level guard would stack on every route registered after it).
 */
export function permission(required: string) {
  return ({ auth, tenantState, set, request }: GuardCtx) => {
    const rid = String(
      set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId(),
    );
    if (!auth) {
      set.status = 401;
      return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', rid);
    }
    if (!tenantState?.can(required)) {
      set.status = 403;
      return fail('forbidden', `Anda tidak punya izin ${required}`, rid, { permission: required });
    }
    return undefined;
  };
}
