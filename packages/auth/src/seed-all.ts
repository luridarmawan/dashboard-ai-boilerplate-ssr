import { env } from '@core/config';
import { unsafeAcrossTenants } from '@core/db';
import { moduleSeeds } from '@core/module-kit/seeds';
import { runSeed, type SeedResult } from './seed.ts';

/**
 * Idempotent bootstrap seed (PRD O-3): default tenant, system groups, first superadmin from
 * BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD (C-5), then every module's seed for the
 * default tenant. Re-running is harmless. Shared by `bun db:seed` and the compiled `api seed`.
 */
export async function runSeedAll(log: (line: string) => void = console.log): Promise<SeedResult> {
  const e = env();
  // Seeding touches several tenants' worth of bootstrap rows by definition.
  const result = await runSeed(unsafeAcrossTenants(), {
    ...(e.BOOTSTRAP_ADMIN_EMAIL ? { adminEmail: e.BOOTSTRAP_ADMIN_EMAIL } : {}),
    ...(e.BOOTSTRAP_ADMIN_PASSWORD ? { adminPassword: e.BOOTSTRAP_ADMIN_PASSWORD } : {}),
    log: (m) => log(`db:seed: ${m}`),
  });
  log(
    `db:seed: selesai — tenant ${result.tenantId.slice(0, 8)}…, ${result.created.length ? `dibuat: ${result.created.join(', ')}` : 'tidak ada yang baru'}${result.adminUserId ? '' : ' (BOOTSTRAP_ADMIN_* tidak diset — superadmin dilewati)'}`,
  );
  for (const s of moduleSeeds) {
    await s.run({
      db: unsafeAcrossTenants(),
      tenantId: result.tenantId,
      log: (m) => log(`db:seed[${s.module}]: ${m}`),
    });
  }
  await unsafeAcrossTenants().$client.end();
  return result;
}
