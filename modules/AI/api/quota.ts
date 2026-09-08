import { settings } from '@app/api/services';
import { and, desc, eq, gte, newId, schema, sum, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';

/**
 * AI quotas and balance (PRD B-6, H-14). Two independent limits, both optional:
 *
 *   tokens   `ai.quota_tokens_month` (tenant) and `ai.quota_tokens_user_month` (per user) — total
 *            tokens of successful calls in the current UTC calendar month, from `ai_calls`;
 *            0 = unlimited
 *   balance  `ai_credits.balance_micro` — prepaid credit in micro-units of the currency, charged
 *            with each call's `cost_micro`; NULL (no row) = unlimited; refused once ≤ 0
 *
 * The check runs before the provider is called; usage is written after, so a single call may
 * overshoot by at most its own size — acceptable for a quota, and it never blocks the hot path.
 */

export interface QuotaSide {
  readonly used: number;
  /** 0 = unlimited */
  readonly limit: number;
}
export interface QuotaState {
  readonly ok: boolean;
  readonly reason: 'tenant_quota' | 'user_quota' | 'credit_exhausted' | null;
  readonly tenant: QuotaSide;
  readonly user: QuotaSide;
  readonly credit: { balanceMicro: number | null; spentMicro: number };
  readonly monthStart: string;
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function tokensSince(clientId: string, since: Date, userId?: string): Promise<number> {
  const db = unsafeAcrossTenants(); // tenant condition explicit
  const [row] = await db
    .select({ total: sum(schema.aiCalls.tokens_total) })
    .from(schema.aiCalls)
    .where(
      and(
        eq(schema.aiCalls.client_id, clientId),
        eq(schema.aiCalls.status, 'ok'),
        gte(schema.aiCalls.created_at, since),
        userId ? eq(schema.aiCalls.user_id, userId) : undefined,
      ),
    );
  return Number(row?.total ?? 0) || 0;
}

export async function creditOf(clientId: string) {
  const [row] = await unsafeAcrossTenants()
    .select()
    .from(schema.aiCredits)
    .where(eq(schema.aiCredits.client_id, clientId))
    .limit(1);
  return {
    balanceMicro:
      row?.balance_micro === null || row?.balance_micro === undefined
        ? null
        : Number(row.balance_micro),
    spentMicro: Number(row?.spent_micro ?? 0),
  };
}

export async function checkQuota(
  clientId: string,
  userId: string | null,
  now = new Date(),
): Promise<QuotaState> {
  const start = monthStart(now);
  const tenantLimit = Math.max(
    0,
    (await settings.get<number | null>(clientId, 'ai.quota_tokens_month')) ?? 0,
  );
  const userLimit = Math.max(
    0,
    (await settings.get<number | null>(clientId, 'ai.quota_tokens_user_month')) ?? 0,
  );
  const [tenantUsed, userUsed, credit] = await Promise.all([
    tenantLimit ? tokensSince(clientId, start) : Promise.resolve(0),
    userLimit && userId ? tokensSince(clientId, start, userId) : Promise.resolve(0),
    creditOf(clientId),
  ]);
  let reason: QuotaState['reason'] = null;
  if (credit.balanceMicro !== null && credit.balanceMicro <= 0) reason = 'credit_exhausted';
  else if (tenantLimit && tenantUsed >= tenantLimit) reason = 'tenant_quota';
  else if (userLimit && userUsed >= userLimit) reason = 'user_quota';
  return {
    ok: reason === null,
    reason,
    tenant: { used: tenantUsed, limit: tenantLimit },
    user: { used: userUsed, limit: userLimit },
    credit,
    monthStart: start.toISOString(),
  };
}

/** Charge a finished call against the balance (no-op without a balance row). Fire-and-forget safe. */
export async function chargeCredit(clientId: string, costMicro: number): Promise<void> {
  if (!costMicro) return;
  const db = unsafeAcrossTenants();
  const [row] = await db
    .select()
    .from(schema.aiCredits)
    .where(eq(schema.aiCredits.client_id, clientId))
    .limit(1);
  if (!row) return;
  await db
    .update(schema.aiCredits)
    .set({
      spent_micro: Number(row.spent_micro) + costMicro,
      ...(row.balance_micro === null
        ? {}
        : { balance_micro: Number(row.balance_micro) - costMicro }),
    })
    .where(eq(schema.aiCredits.id, row.id));
}

/**
 * Top up (positive) or adjust (negative) the balance; `null` amount with `unlimited` removes the
 * limit. Creates the row on first use. Returns the new state.
 */
export async function adjustCredit(
  clientId: string,
  change: { amountMicro: number } | { unlimited: true },
  note: string | null,
  actorId: string | null,
) {
  const db = unsafeAcrossTenants();
  const [row] = await db
    .select()
    .from(schema.aiCredits)
    .where(eq(schema.aiCredits.client_id, clientId))
    .limit(1);
  const current =
    row?.balance_micro === null || row?.balance_micro === undefined
      ? null
      : Number(row.balance_micro);
  const next = 'unlimited' in change ? null : (current ?? 0) + change.amountMicro;
  if (row)
    await db
      .update(schema.aiCredits)
      .set({ balance_micro: next })
      .where(eq(schema.aiCredits.id, row.id));
  else
    await db
      .insert(schema.aiCredits)
      .values({ id: newId(), client_id: clientId, balance_micro: next, spent_micro: 0 });
  await db.insert(schema.aiCreditLedger).values({
    id: newId(),
    client_id: clientId,
    amount_micro: 'unlimited' in change ? 0 : change.amountMicro,
    balance_after_micro: next,
    note: note?.slice(0, 255) ?? ('unlimited' in change ? 'batas dihapus' : null),
    actor_id: actorId,
  });
  logger.info('ai: credit adjusted', { clientId, next, actorId });
  return creditOf(clientId);
}

export async function creditLedger(clientId: string, limit = 50) {
  return unsafeAcrossTenants()
    .select()
    .from(schema.aiCreditLedger)
    .where(eq(schema.aiCreditLedger.client_id, clientId))
    .orderBy(desc(schema.aiCreditLedger.created_at))
    .limit(limit);
}
