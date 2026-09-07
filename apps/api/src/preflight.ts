import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type Env, EnvError, loadEnv } from '@core/config';
import { activeDialect, schema, unsafeAcrossTenants } from '@core/db';
import { familyOf, migrationStatus, probeDatabase } from '@core/db/migrate';
import { modules } from '@core/module-kit/registry';

/**
 * `api preflight` (PRD Q-13): is this environment ready to run the app? Every check answers with
 * a fact and, when it fails, with the command that fixes it — so an operator never has to read a
 * stack trace to learn that a password is still `change-me` or that a migration is pending.
 *
 * Read-only by design: it never migrates, seeds or writes settings. It is what `deploy/upgrade.sh`
 * runs before a rollout and what the systemd unit runs as `ExecStartPre`.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';
export interface Check {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly hint?: string;
  readonly ms?: number;
}
export interface PreflightResult {
  readonly ok: boolean;
  readonly checks: readonly Check[];
}

const PLACEHOLDER = /change-me|example\.com|please/i;

export async function runPreflight(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PreflightResult> {
  const checks: Check[] = [];
  const push = (c: Check) => checks.push(c);
  const timed = async <T>(
    fn: () => Promise<T>,
  ): Promise<{ value?: T; error?: string; ms: number }> => {
    const t0 = performance.now();
    try {
      return { value: await fn(), ms: Math.round(performance.now() - t0) };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        ms: Math.round(performance.now() - t0),
      };
    }
  };

  // 1. env — everything else depends on it, so stop here when it is broken.
  let e: Env;
  try {
    e = loadEnv(source);
    push({
      name: 'env',
      status: 'ok',
      detail: `NODE_ENV=${e.NODE_ENV}, DB_DIALECT=${e.DB_DIALECT}`,
    });
  } catch (err) {
    const problems = err instanceof EnvError ? err.problems : [String(err)];
    for (const p of problems)
      push({
        name: 'env',
        status: 'fail',
        detail: p,
        hint: 'isi variabel itu di .env.prod (Docker) atau /etc/dab/api.env (systemd); lihat .env.prod.example',
      });
    return { ok: false, checks };
  }

  // 2. production sanity — placeholders and insecure defaults.
  if (e.NODE_ENV === 'production') {
    if (PLACEHOLDER.test(e.DATABASE_URL))
      push({
        name: 'secrets',
        status: 'fail',
        detail: 'DATABASE_URL masih memakai nilai contoh',
        hint: 'ganti MYSQL_PASSWORD / DATABASE_URL di .env.prod, lalu `dc run --rm db-init`',
      });
    if (e.BOOTSTRAP_ADMIN_PASSWORD && PLACEHOLDER.test(e.BOOTSTRAP_ADMIN_PASSWORD))
      push({
        name: 'secrets',
        status: 'fail',
        detail: 'BOOTSTRAP_ADMIN_PASSWORD masih nilai contoh',
        hint: 'ganti di .env.prod sebelum seed; hapus setelah admin pertama masuk',
      });
    if (e.BOOTSTRAP_ADMIN_EMAIL && PLACEHOLDER.test(e.BOOTSTRAP_ADMIN_EMAIL))
      push({
        name: 'secrets',
        status: 'warn',
        detail: `BOOTSTRAP_ADMIN_EMAIL=${e.BOOTSTRAP_ADMIN_EMAIL} terlihat seperti contoh`,
      });
    if (!e.APP_ORIGIN_PRIMARY?.startsWith('https://'))
      push({
        name: 'origin',
        status: 'warn',
        detail: `APP_ORIGIN tanpa https (${e.APP_ORIGINS.join(', ') || 'kosong'})`,
        hint: 'tautan email dan cookie Secure butuh origin https; set DOMAIN / APP_ORIGIN',
      });
    else push({ name: 'origin', status: 'ok', detail: e.APP_ORIGINS.join(', ') });
    if (e.SIGNUP_ENABLED)
      push({
        name: 'signup',
        status: 'warn',
        detail: 'SIGNUP_ENABLED=true di production — siapa pun bisa mendaftar',
        hint: 'hapus SIGNUP_ENABLED atau set false bila aplikasi ini bukan layanan publik',
      });
    if (!e.SMTP_HOST)
      push({
        name: 'smtp',
        status: 'warn',
        detail: 'SMTP_HOST kosong — email antre di outbox sampai SMTP diisi',
        hint: 'isi SMTP_* di .env.prod atau Pengaturan → Email; uji: bun run mail:test',
      });
    if (!checks.some((c) => c.name === 'secrets'))
      push({ name: 'secrets', status: 'ok', detail: 'tidak ada nilai contoh yang tertinggal' });
  }

  // 3. dialect — the build binds one driver and one migration set.
  const built = familyOf(activeDialect);
  const wanted = familyOf(e.DB_DIALECT);
  if (built !== wanted) {
    push({
      name: 'dialect',
      status: 'fail',
      detail: `build untuk ${activeDialect}, DB_DIALECT=${e.DB_DIALECT}`,
      hint: 'build ulang image dengan --build-arg DB_DIALECT yang benar (atau bun db:codegen dari sumber)',
    });
    return { ok: false, checks };
  }
  push({
    name: 'dialect',
    status: 'ok',
    detail: `${e.DB_DIALECT}${e.TABLE_PREFIX ? `, TABLE_PREFIX=${e.TABLE_PREFIX}` : ''}`,
  });

  // 4. database reachable — probed on the URL given to preflight, over a fresh connection.
  const db = await timed(() => probeDatabase(e.DATABASE_URL, e.DB_DIALECT));
  if (db.error) {
    push({
      name: 'database',
      status: 'fail',
      detail: db.error.slice(0, 200),
      ms: db.ms,
      hint: 'periksa DATABASE_URL, service mysql/postgres sehat (`dc ps`), kata sandi (`dc run --rm db-init`) dan firewall',
    });
    return { ok: false, checks };
  }
  push({ name: 'database', status: 'ok', detail: 'terjangkau', ms: db.ms });

  // 5. migrations — pending means the schema in the database is behind this build.
  const mig = await timed(() => migrationStatus(e));
  if (mig.error || !mig.value) {
    push({
      name: 'migrations',
      status: 'fail',
      detail: mig.error ?? 'tidak bisa membaca jurnal',
      ms: mig.ms,
      hint: 'jalankan `dc run --rm migrate`',
    });
  } else if (mig.value.applied === 0) {
    push({
      name: 'migrations',
      status: 'fail',
      detail: `database kosong — 0 dari ${mig.value.embedded} migrasi diterapkan`,
      ms: mig.ms,
      hint: 'jalankan `dc run --rm migrate` lalu `dc run --rm seed` (langkah 5–6 DEPLOY.md)',
    });
  } else if (mig.value.pending > 0) {
    push({
      name: 'migrations',
      status: 'fail',
      detail: `${mig.value.pending} migrasi belum diterapkan (${mig.value.applied}/${mig.value.embedded})`,
      ms: mig.ms,
      hint: 'jalankan `dc run --rm migrate` sebelum menyalakan versi ini (Q-4)',
    });
  } else {
    push({
      name: 'migrations',
      status: 'ok',
      detail: `mutakhir — ${mig.value.applied} migrasi`,
      ms: mig.ms,
    });
    // 6. seed — only meaningful once the schema exists.
    const seeded = await timed(
      async () =>
        (
          await unsafeAcrossTenants()
            .select({ id: schema.clients.id })
            .from(schema.clients)
            .limit(1)
        ).length,
    );
    if (seeded.error) push({ name: 'seed', status: 'warn', detail: seeded.error.slice(0, 200) });
    else if (seeded.value === 0)
      push({
        name: 'seed',
        status: 'warn',
        detail: 'belum ada tenant — seed belum dijalankan',
        hint: 'jalankan `dc run --rm seed` (idempoten)',
      });
    else push({ name: 'seed', status: 'ok', detail: 'tenant baku ada' });
  }

  // 7. redis — a dependency only when a driver uses it (Decision M).
  const usesRedis = [e.SESSION_DRIVER, e.CACHE_DRIVER, e.RATELIMIT_DRIVER].includes('redis');
  if (usesRedis) {
    const ping = await timed(async () => {
      const Client = (
        Bun as unknown as {
          RedisClient: new (
            url: string,
          ) => { send(cmd: string, args: string[]): Promise<unknown>; close(): void };
        }
      ).RedisClient;
      const client = new Client(e.REDIS_URL ?? '');
      const pong = await client.send('PING', []);
      client.close();
      return String(pong).toUpperCase();
    });
    if (ping.error || ping.value !== 'PONG')
      push({
        name: 'redis',
        status: 'fail',
        detail: ping.error ?? `jawaban ${ping.value}`,
        ms: ping.ms,
        hint: 'REDIS_URL benar? service valkey hidup (`dc --profile redis ps`)? atau kembalikan *_DRIVER ke database',
      });
    else push({ name: 'redis', status: 'ok', detail: e.REDIS_URL ?? '', ms: ping.ms });
  } else push({ name: 'redis', status: 'skip', detail: 'tidak dipakai (semua *_DRIVER=database)' });

  // 8. uploads volume — exists, owned/writable by this user.
  try {
    if (!existsSync(e.UPLOADS_DIR)) mkdirSync(e.UPLOADS_DIR, { recursive: true });
    accessSync(e.UPLOADS_DIR, constants.W_OK);
    const probe = join(e.UPLOADS_DIR, `.preflight-${process.pid}`);
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
    push({ name: 'uploads', status: 'ok', detail: `${e.UPLOADS_DIR} bisa ditulis` });
  } catch (err) {
    push({
      name: 'uploads',
      status: 'fail',
      detail: `${e.UPLOADS_DIR}: ${err instanceof Error ? err.message : String(err)}`,
      hint: 'volume harus dimiliki uid 1000 (user app): `docker run --rm -v dab-prod_uploads:/u alpine chown -R 1000:1000 /u`; systemd: chown dab:dab',
    });
  }

  // 9. modules in sync — only checkable where modules.json is present (source checkouts).
  const manifest = join(process.cwd(), 'modules.json');
  if (existsSync(manifest)) {
    try {
      const declared = (
        JSON.parse(readFileSync(manifest, 'utf8')) as { modules: { name: string }[] }
      ).modules
        .map((m) => m.name)
        .sort();
      const built_ = modules.map((m) => m.name).sort();
      if (declared.join(',') !== built_.join(','))
        push({
          name: 'modules',
          status: 'fail',
          detail: `modules.json: ${declared.join(', ')} ≠ registry: ${built_.join(', ')}`,
          hint: 'jalankan `bun modules:sync` (atau build ulang)',
        });
      else
        push({
          name: 'modules',
          status: 'ok',
          detail: `${built_.length} modul tersinkron: ${built_.join(', ')}`,
        });
    } catch (err) {
      push({
        name: 'modules',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  } else
    push({
      name: 'modules',
      status: 'ok',
      detail: `${modules.length} modul tersemat saat build: ${modules.map((m) => m.name).join(', ')}`,
    });

  return { ok: !checks.some((c) => c.status === 'fail'), checks };
}

const MARK: Record<CheckStatus, string> = { ok: '✓', warn: '!', fail: '✗', skip: '–' };

/** Human report, one line per check; the last line is the verdict. */
export function formatPreflight(r: PreflightResult): string {
  const lines = r.checks.map((c) => {
    const ms = c.ms !== undefined ? ` (${c.ms} ms)` : '';
    const hint = c.hint && c.status !== 'ok' ? `\n      → ${c.hint}` : '';
    return `  ${MARK[c.status]} ${c.name.padEnd(11)} ${c.detail}${ms}${hint}`;
  });
  const fails = r.checks.filter((c) => c.status === 'fail').length;
  const warns = r.checks.filter((c) => c.status === 'warn').length;
  lines.push(
    r.ok
      ? `preflight: LOLOS — siap dijalankan (${warns} peringatan)`
      : `preflight: GAGAL — ${fails} pemeriksaan gagal, ${warns} peringatan; perbaiki dulu sebelum start`,
  );
  return lines.join('\n');
}
