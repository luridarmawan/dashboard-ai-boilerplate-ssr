import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSeed } from '@core/auth';
import { unsafeAcrossTenants } from '@core/db';
import { formatPreflight, runPreflight } from '../../src/preflight.ts';

/**
 * Integration (INTEGRATION=1): `api preflight` (Q-13) against the real test database — green on a
 * migrated + seeded database, and each failure names the problem AND the command that fixes it.
 */
const enabled = process.env.INTEGRATION === '1';
const run = Date.now();
const byName = (r: Awaited<ReturnType<typeof runPreflight>>, name: string) =>
  r.checks.filter((c) => c.name === name);

describe.skipIf(!enabled)('api preflight (Q-13)', () => {
  test('a migrated, seeded database with a writable uploads dir passes', async () => {
    await runSeed(unsafeAcrossTenants(), {
      adminEmail: `preflight-${run}@example.test`,
      adminPassword: 'a bootstrap admin password',
    });
    const r = await runPreflight({
      ...process.env,
      UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'dab-up-')),
    });
    const text = formatPreflight(r);
    expect(r.ok, text).toBe(true);
    expect(byName(r, 'database')[0]?.status).toBe('ok');
    expect(byName(r, 'migrations')[0]?.status).toBe('ok');
    expect(byName(r, 'migrations')[0]?.detail).toMatch(/mutakhir — \d+ migrasi/);
    expect(byName(r, 'seed')[0]?.status).toBe('ok');
    expect(byName(r, 'uploads')[0]?.status).toBe('ok');
    // Run from the repo root: modules.json is present and must agree with the built registry.
    expect(byName(r, 'modules')[0]?.status).toBe('ok');
    expect(byName(r, 'modules')[0]?.detail).toContain('AI');
    expect(byName(r, 'redis')[0]?.status).toBe('skip');
    expect(text).toContain('preflight: LOLOS');
  });

  test('missing env stops early with one line per problem and a hint', async () => {
    const { DATABASE_URL: _drop, ...rest } = process.env;
    void _drop;
    const r = await runPreflight(rest as Record<string, string | undefined>);
    expect(r.ok).toBe(false);
    expect(
      byName(r, 'env').some((c) => c.status === 'fail' && c.detail.includes('DATABASE_URL')),
    ).toBe(true);
    expect(byName(r, 'env')[0]?.hint).toContain('.env.prod');
    expect(byName(r, 'database')).toHaveLength(0); // nothing else attempted
  });

  test('unreachable database → actionable failure; wrong dialect → rebuild hint', async () => {
    const down = await runPreflight({ ...process.env, DATABASE_URL: 'mysql://x:y@127.0.0.1:1/x' });
    expect(down.ok).toBe(false);
    expect(byName(down, 'database')[0]?.status).toBe('fail');
    expect(byName(down, 'database')[0]?.hint).toContain('DATABASE_URL');

    const dialect = await runPreflight({
      ...process.env,
      DB_DIALECT: 'postgres',
      DATABASE_URL: 'postgres://x:y@127.0.0.1:1/x',
    });
    expect(dialect.ok).toBe(false);
    expect(byName(dialect, 'dialect')[0]?.status).toBe('fail');
    expect(byName(dialect, 'dialect')[0]?.hint).toContain('DB_DIALECT');
  });

  test('production placeholders are refused; an unwritable uploads dir fails with the chown hint', async () => {
    const r = await runPreflight({
      ...process.env,
      NODE_ENV: 'production',
      BOOTSTRAP_ADMIN_PASSWORD: 'change-me-please-now',
      APP_ORIGIN: 'https://app.example.test',
      UPLOADS_DIR: '/proc/dab-cannot-write-here',
    });
    expect(r.ok).toBe(false);
    expect(
      byName(r, 'secrets').some(
        (c) => c.status === 'fail' && c.detail.includes('BOOTSTRAP_ADMIN_PASSWORD'),
      ),
    ).toBe(true);
    expect(byName(r, 'uploads')[0]?.status).toBe('fail');
    expect(byName(r, 'uploads')[0]?.hint).toContain('chown');
    expect(byName(r, 'smtp')[0]?.status).toBe('warn');
    expect(formatPreflight(r)).toContain('preflight: GAGAL');
  });
});
