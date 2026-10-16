import { isMaintenanceExempt, writeAudit } from '@core/auth';
import { env } from '@core/config';
import { fail } from '@core/contracts';
import type { Db } from '@core/db';
import { settings } from './services.ts';

/**
 * Maintenance mode (PRD E-10) has two switches that close the same door:
 *
 *   - `MAINTENANCE_MODE=true` in `.env` — deployment-wide, read before any database is touched,
 *     for the moments the database itself is being migrated or restored. Everything answers
 *     503 except signing in and the few reads the sign-in page needs.
 *   - `app.maintenance_mode` in Settings — per tenant with global fallback, flipped by an admin
 *     without a restart. Anonymous visitors keep the public pages (a shop stays browsable);
 *     signed-in users outside the Administrator group are shut out, and modules consult
 *     `maintenanceState()` to switch their own features off (checkout, posting, …).
 *
 * In both cases only a superadmin or a live member of the tenant's Administrator group may sign
 * in or keep working (`isMaintenanceExempt`). The error code is `maintenance`, status 503.
 */
export type MaintenanceSource = 'env' | 'config';

export interface MaintenanceState {
  readonly active: boolean;
  /** Which switch is on; `env` wins when both are. Null while inactive. */
  readonly source: MaintenanceSource | null;
}

const OFF: MaintenanceState = { active: false, source: null };

/** Is maintenance on for this tenant? `.env` first (no database), then the tenant's setting. */
export async function maintenanceState(clientId: string | null): Promise<MaintenanceState> {
  if (env().MAINTENANCE_MODE) return { active: true, source: 'env' };
  const stored = await settings.get<boolean | null>(clientId, 'app.maintenance_mode');
  return stored === true ? { active: true, source: 'config' } : OFF;
}

/** Message of the 503 — Indonesian like every API message; the web localises from the code. */
export const MAINTENANCE_MESSAGE =
  'Sedang dalam pemeliharaan — hanya administrator yang bisa masuk untuk sementara';

/**
 * The 503 envelope every refused request gets. `details.source` says which switch is on, so an
 * operator reading a client's log knows whether to look at `.env` or at Settings.
 */
export function maintenanceFailure(requestId: string, source: MaintenanceSource) {
  return fail('maintenance', MAINTENANCE_MESSAGE, requestId, { source });
}

/**
 * Sign-in gate, shared by the password, MFA and Google flows: a verified user who is not exempt
 * gets 503 `maintenance` instead of a session, and the attempt is audited so an operator can see
 * who knocked while the door was closed. Returns null when the user may sign in.
 */
export async function refuseLoginDuringMaintenance(p: {
  db: Db;
  user: { id: string; is_superadmin: boolean };
  clientId: string | null;
  ip: string;
  requestId: string;
  set: { status?: number | string; headers: Record<string, string | number | undefined> };
}) {
  const state = await maintenanceState(p.clientId);
  if (!state.active || !state.source) return null;
  if (await isMaintenanceExempt(p.db, p.user, p.clientId)) return null;
  await writeAudit(p.db, {
    clientId: p.clientId,
    actorId: p.user.id,
    action: 'auth.login_refused_maintenance',
    resource: 'user',
    resourceId: p.user.id,
    ip: p.ip,
    requestId: p.requestId,
    after: { source: state.source },
  });
  p.set.status = 503;
  p.set.headers['retry-after'] = '300';
  return maintenanceFailure(p.requestId, state.source);
}
