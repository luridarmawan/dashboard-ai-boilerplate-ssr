import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): the module catalog (PRD G-16). The bundled catalog lists the
 * in-tree modules as installed; a catalog file with more entries yields available / incompatible
 * statuses and the exact install command; a missing catalog still answers with what is installed;
 * only module.manage may read it.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.99.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `catalog-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `catalog-member-${run}@example.test`;

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
type Entry = {
  name: string;
  status: string;
  installedVersion: string | null;
  installCommand: string | null;
  bundled: boolean;
};
type Result = { source: string; error: string | null; entries: Entry[] };

describe.skipIf(!enabled)('module catalog (G-16)', () => {
  let db: Db;
  let admin = '';
  let member = '';
  const prevFile = process.env.MODULES_CATALOG_FILE;
  const tmp = `/tmp/dab-catalog-${run}.json`;

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    await runSeed(db, { adminEmail, adminPassword });
    admin = sessionCookie(
      await call('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      }),
    );
    const reg = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: memberEmail,
        password: 'a regular member password',
        name: 'M',
      }),
    });
    member = sessionCookie(reg);
  });
  afterAll(() => {
    if (prevFile === undefined) delete process.env.MODULES_CATALOG_FILE;
    else process.env.MODULES_CATALOG_FILE = prevFile;
  });

  test('module.manage only', async () => {
    expect((await call('/v1/module/catalog')).status).toBe(401);
    expect((await call('/v1/module/catalog', {}, [member])).status).toBe(403);
  });

  test('the bundled catalog knows the in-tree modules as installed, without an install command', async () => {
    delete process.env.MODULES_CATALOG_FILE;
    const r = await call('/v1/module/catalog', {}, [admin]);
    expect(r.status).toBe(200);
    const d = (await json(r)).data as Result;
    expect(['file', 'none']).toContain(d.source);
    const ai = d.entries.find((e) => e.name === 'AI');
    expect(ai?.status).toBe('installed');
    expect(ai?.installCommand).toBeNull();
    expect(ai?.installedVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('a catalog with more entries: available with the exact command, incompatible without one; unknown installed modules still listed', async () => {
    await Bun.write(
      tmp,
      JSON.stringify({
        modules: [
          {
            name: 'Billing',
            version: '1.2.0',
            repo: 'git@example.test:tim/mod-billing.git',
            ref: 'v1.2.0',
            engines: { core: '>=0.0.0' },
            tags: ['finance'],
          },
          {
            name: 'Future',
            version: '3.0.0',
            repo: 'git@example.test:tim/future.git',
            ref: 'v3.0.0',
            engines: { core: '>=99.0.0' },
          },
        ],
      }),
    );
    process.env.MODULES_CATALOG_FILE = tmp;
    const d = (await json(await call('/v1/module/catalog', {}, [admin]))).data as Result;
    expect(d.source).toBe('file');
    expect(d.error).toBeNull();
    const billing = d.entries.find((e) => e.name === 'Billing');
    expect(billing?.status).toBe('available');
    expect(billing?.installCommand).toBe(
      'bun modules:add git@example.test:tim/mod-billing.git --ref v1.2.0',
    );
    const future = d.entries.find((e) => e.name === 'Future');
    expect(future?.status).toBe('incompatible');
    expect(future?.installCommand).toBeNull();
    // Installed but absent from this catalog: still shown, as installed.
    expect(d.entries.find((e) => e.name === 'AI')?.status).toBe('installed');
  });

  test('a missing catalog file degrades to the installed list and says why', async () => {
    process.env.MODULES_CATALOG_FILE = `/tmp/does-not-exist-${run}.json`;
    const d = (await json(await call('/v1/module/catalog', {}, [admin]))).data as Result;
    expect(d.source).toBe('none');
    expect(d.error).toContain('tidak ada');
    expect(d.entries.map((e) => e.name)).toContain('Example');
  });
});
