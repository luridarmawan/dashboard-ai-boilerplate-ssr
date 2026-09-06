#!/usr/bin/env bun
import { env } from '@core/config';
import { unsafeAcrossTenants } from '@core/db';
/**
 * `bun db:seed` (root) → `bun run --cwd packages/auth seed` — idempotent seed (PRD O-3): default tenant, system groups, first superadmin
 * from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD (C-5). Re-running is harmless.
 */
import { moduleSeeds } from '@core/module-kit/seeds';
import { runSeed } from '../src/index.ts';

const e = env();
// Seeding touches several tenants' worth of bootstrap rows by definition.
const result = await runSeed(unsafeAcrossTenants(), {
  adminEmail: e.BOOTSTRAP_ADMIN_EMAIL,
  adminPassword: e.BOOTSTRAP_ADMIN_PASSWORD,
  log: (m) => console.log(`db:seed: ${m}`),
});
console.log(
  `db:seed: selesai — tenant ${result.tenantId.slice(0, 8)}…, ${result.created.length ? `dibuat: ${result.created.join(', ')}` : 'tidak ada yang baru'}${result.adminUserId ? '' : ' (BOOTSTRAP_ADMIN_* tidak diset — superadmin dilewati)'}`,
);
// Module seeds (idempotent, O-3): demo/reference rows for the default tenant, after the core seed.
for (const s of moduleSeeds) {
  await s.run({
    db: unsafeAcrossTenants(),
    tenantId: result.tenantId,
    log: (m) => console.log(`db:seed[${s.module}]: ${m}`),
  });
}
await unsafeAcrossTenants().$client.end();
