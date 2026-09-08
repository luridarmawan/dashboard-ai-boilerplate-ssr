import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { runLogRetentionOnce } from '../../src/retention.ts';

/**
 * Integration (INTEGRATION=1): log retention (PRD M-3). Rows older than the policy disappear,
 * younger rows and pending/running rows stay, whatever their age.
 */
const enabled = process.env.INTEGRATION === '1';
const day = 86_400_000;

describe.skipIf(!enabled)('log retention (M-3)', () => {
  let db: Db;
  let tenantId = '';
  const tag = `ret-${Date.now()}`;
  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    tenantId = (await runSeed(db)).tenantId;
  });

  test('prunes old audit, finished job runs and sent/failed emails; keeps young, pending and running rows', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 400 * day);
    const young = new Date(now.getTime() - 2 * day);
    const ids = {
      auditOld: newId(),
      auditYoung: newId(),
      runOld: newId(),
      runRunning: newId(),
      mailSentOld: newId(),
      mailPendingOld: newId(),
    };
    await db.insert(schema.auditLog).values([
      {
        id: ids.auditOld,
        client_id: tenantId,
        action: 'test.old',
        resource: tag,
        created_at: old,
        updated_at: old,
      },
      {
        id: ids.auditYoung,
        client_id: tenantId,
        action: 'test.young',
        resource: tag,
        created_at: young,
        updated_at: young,
      },
    ] as never);
    await db.insert(schema.schedulerRuns).values([
      {
        id: ids.runOld,
        job: `core.test.${tag}`,
        instance_id: 't',
        started_at: old,
        finished_at: old,
        duration_ms: 1,
        status: 'ok',
        created_at: old,
        updated_at: old,
      },
      {
        id: ids.runRunning,
        job: `core.test.${tag}`,
        instance_id: 't',
        started_at: old,
        finished_at: null,
        status: 'running',
        created_at: old,
        updated_at: old,
      },
    ] as never);
    await db.insert(schema.outboxEmail).values([
      {
        id: ids.mailSentOld,
        client_id: tenantId,
        to_address: `${tag}@example.test`,
        subject: 's',
        template: 'contact',
        locale: 'id',
        status: 'sent',
        created_at: old,
        updated_at: old,
        next_attempt_at: old,
      },
      {
        id: ids.mailPendingOld,
        client_id: tenantId,
        to_address: `${tag}@example.test`,
        subject: 's',
        template: 'contact',
        locale: 'id',
        status: 'pending',
        created_at: old,
        updated_at: old,
        next_attempt_at: old,
      },
    ] as never);

    const r = await runLogRetentionOnce(now);
    expect(r.days).toEqual({
      audit: 365,
      schedulerRuns: 14,
      outbox: 30,
      notifications: 90,
      webhooks: 30,
      queue: 14,
    }); // registry defaults
    expect(r.audit).toBeGreaterThanOrEqual(1);
    expect(r.schedulerRuns).toBeGreaterThanOrEqual(1);
    expect(r.outbox).toBeGreaterThanOrEqual(1);

    const has = async (
      table: typeof schema.auditLog | typeof schema.schedulerRuns | typeof schema.outboxEmail,
      id: string,
    ) =>
      (await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1)).length === 1;
    expect(await has(schema.auditLog, ids.auditOld)).toBe(false);
    expect(await has(schema.auditLog, ids.auditYoung)).toBe(true);
    expect(await has(schema.schedulerRuns, ids.runOld)).toBe(false);
    expect(await has(schema.schedulerRuns, ids.runRunning)).toBe(true);
    expect(await has(schema.outboxEmail, ids.mailSentOld)).toBe(false);
    expect(await has(schema.outboxEmail, ids.mailPendingOld)).toBe(true);

    // The pending row is still deliverable state for the outbox job; clean it up ourselves.
    await db.delete(schema.outboxEmail).where(eq(schema.outboxEmail.id, ids.mailPendingOld));
    await db.delete(schema.schedulerRuns).where(eq(schema.schedulerRuns.id, ids.runRunning));
  });
});
