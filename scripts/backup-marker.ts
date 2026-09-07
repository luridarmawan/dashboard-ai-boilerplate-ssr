#!/usr/bin/env bun
/**
 * Helper for the backup/restore proof (PRD §8 #24).
 *   write  <code>   create a tenant row that must survive backup → destroy → restore
 *   check  <code>   exit 0 when the tenant exists, 1 when the table or row is gone
 *   verify <code>   the application works again: login with BOOTSTRAP_ADMIN_* through the real app,
 *                   /v1/me answers, and the marker tenant is listed
 */
import { eq, newId, schema, unsafeAcrossTenants } from '@core/db';

const [cmd, code] = process.argv.slice(2);
if (!cmd || !code) {
  console.error('Pemakaian: bun run scripts/backup-marker.ts write|check|verify <code>');
  process.exit(2);
}
const db = unsafeAcrossTenants();

async function exists(): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(eq(schema.clients.code, code as string))
      .limit(1);
    return rows.length === 1;
  } catch {
    return false; // table gone (database dropped)
  }
}

if (cmd === 'write') {
  await db
    .insert(schema.clients)
    .values({ id: newId(), code, name: `Backup proof ${code}` } as never);
  console.log(`marker: tenant ${code} dibuat`);
  process.exit(0); // the pool would otherwise keep the process alive
} else if (cmd === 'check') {
  const ok = await exists();
  console.log(`marker: ${ok ? 'ada' : 'TIDAK ADA'}`);
  process.exit(ok ? 0 : 1);
} else if (cmd === 'verify') {
  if (!(await exists())) {
    console.error('verify: tenant penanda hilang setelah restore');
    process.exit(1);
  }
  const { app } = await import('../apps/api/src/app.ts');
  const ORIGIN = 'http://api.test';
  const TOKEN = 'C'.repeat(43);
  const login = await app.handle(
    new Request(`${ORIGIN}/v1/auth/login`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie: `dab_csrf=${TOKEN}`,
        'x-csrf-token': TOKEN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: process.env.BOOTSTRAP_ADMIN_EMAIL,
        password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      }),
    }),
  );
  if (login.status !== 200) {
    console.error(`verify: login gagal (${login.status}) ${await login.text()}`);
    process.exit(1);
  }
  const session =
    login.headers
      .getSetCookie()
      .find((c) => c.startsWith('dab_session='))
      ?.split(';')[0] ?? '';
  const me = await app.handle(
    new Request(`${ORIGIN}/v1/auth/me`, { headers: { cookie: `dab_csrf=${TOKEN}; ${session}` } }),
  );
  const tenants = await app.handle(
    new Request(`${ORIGIN}/v1/clients`, { headers: { cookie: `dab_csrf=${TOKEN}; ${session}` } }),
  );
  const list = (await tenants.json()) as { data?: { code: string }[] };
  const listed = list.data?.some((t) => t.code === code) ?? false;
  console.log(
    `verify: login ${login.status}, /v1/auth/me ${me.status}, /v1/clients ${tenants.status}, penanda terdaftar: ${listed}`,
  );
  process.exit(me.status === 200 && tenants.status === 200 && listed ? 0 : 1);
} else {
  console.error(`perintah tidak dikenal: ${cmd}`);
  process.exit(2);
}
