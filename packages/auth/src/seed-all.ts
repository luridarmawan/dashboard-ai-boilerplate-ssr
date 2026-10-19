import { env } from '@core/config';
import { closeDb, unsafeAcrossTenants } from '@core/db';
import { moduleSeeds } from '@core/module-kit/seeds';
import { SettingsStore } from '@core/settings';
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
  if (result.created.includes('client:default')) await seedSiteHeader(log);
  for (const s of moduleSeeds) {
    await s.run({
      db: unsafeAcrossTenants(),
      tenantId: result.tenantId,
      log: (m) => log(`db:seed[${s.module}]: ${m}`),
    });
  }
  await closeDb();
  return result;
}

/**
 * Example contact items in the top bar's right-hand group, so a fresh install shows the feature
 * (Settings → Site header). Global scope, so anonymous visitors see them too.
 *
 * Written ONLY on the run that created the default tenant — the first seed of an installation.
 * The seed runs on every deploy; writing whenever the value is empty would bring the demo items
 * back after an admin cleared them. Through SettingsStore, so the outline is validated like a
 * form save and the config cache version is bumped.
 */
export const SEED_TOPBAR_END = [
  'Bantuan | Help -> mailto:support@example.com',
  '[wa] +62-812-3456-7890 -> https://wa.me/6281234567890',
].join('\n');

async function seedSiteHeader(log: (line: string) => void): Promise<void> {
  const r = await new SettingsStore(unsafeAcrossTenants()).save(null, [
    { key: 'site.topbar_end', value: SEED_TOPBAR_END },
  ]);
  const errors = Object.entries(r.errors);
  if (errors.length) {
    log(
      `db:seed: contoh header situs dilewati — ${errors.map(([k, v]) => `${k}: ${v}`).join('; ')}`,
    );
    return;
  }
  log(
    'db:seed: contoh baris atas (kanan) diisi — ubah atau kosongkan di Pengaturan → Header situs',
  );
}
