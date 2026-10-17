import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { settings } from '@app/api/services';
import { runSeed } from '@core/auth';
import { eq, schema, unsafeAcrossTenants } from '@core/db';

/**
 * The permanent redirects over REAL HTTP, against a running web + API pair that share this
 * process's database. The status code and `Location` header are what a browser, a crawler and
 * `fetch` see — nothing here follows a redirect or runs JavaScript.
 *
 *   INTEGRATION=1 PAGES_WEB_URL=http://127.0.0.1:5177 APP_ORIGIN=http://api.test \
 *     bun test modules/Pages/test/web
 *
 * Pages are created through the in-process app (same database); the 404 handler setting is set
 * to this module for the run and put back afterwards. Set PAGES_WEB_KEEP=<run id> to re-check
 * the URLs of an earlier run without creating anything — run it once, restart the servers, run
 * it again with the printed id, and the same assertions prove the redirects survive a restart.
 */
const WEB = process.env.PAGES_WEB_URL?.replace(/\/$/, '') ?? '';
const enabled = process.env.INTEGRATION === '1' && WEB !== '';
const ORIGIN = 'http://api.test';
const TOKEN = 'D'.repeat(43);
const keep = process.env.PAGES_WEB_KEEP ?? '';
const run = keep || String(Date.now());
const s = (name: string) => `w${run}-${name}`;
const email = `pages-web-${run}@example.test`;
const password = 'a pages web check password';

/** One request, the way a browser navigation asks for a page; redirects are NOT followed. */
const visit = (path: string, accept = 'text/html,application/xhtml+xml,*/*;q=0.8') =>
  fetch(`${WEB}${path}`, { headers: { accept }, redirect: 'manual' });

describe.skipIf(!enabled)('Pages over HTTP: 200, 301 and 404 from the web server', () => {
  let tenantId = '';
  let override: string | null = null;
  let globalBefore: string | null = null;

  beforeAll(async () => {
    const seeded = await runSeed(unsafeAcrossTenants(), {
      adminEmail: email,
      adminPassword: password,
    });
    tenantId = seeded.tenantId;
    // Anonymous visitors read the GLOBAL scope; a tenant override would shadow it for the API.
    const rows = await unsafeAcrossTenants()
      .select({ value: schema.configurations.value, client: schema.configurations.client_id })
      .from(schema.configurations)
      .where(eq(schema.configurations.key, 'app.not_found_route'));
    const read = (clientId: string | null) =>
      rows.find((r) => (r.client ?? null) === clientId)?.value ?? null;
    override = read(tenantId);
    globalBefore = read(null);
    await settings.save(tenantId, [{ key: 'app.not_found_route', value: '' }]);
    const saved = await settings.save(null, [{ key: 'app.not_found_route', value: '/pages' }], {
      notFoundRoutes: ['/pages'],
    });
    expect(saved.errors).toEqual({});
    if (keep) return;

    const login = await app.handle(
      new Request(`${ORIGIN}/v1/auth/login`, {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie: `crk_csrf=${TOKEN}`,
          'x-csrf-token': TOKEN,
          'content-type': 'application/json',
          'x-forwarded-for': `10.97.${Math.floor(Number(run) / 1000) % 250}.${Number(run) % 250}`,
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    const session =
      login.headers
        .getSetCookie()
        .find((c) => c.startsWith('crk_session='))
        ?.split(';')[0] ?? '';
    const send = async (method: string, path: string, body: unknown) => {
      const res = await app.handle(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: {
            origin: ORIGIN,
            cookie: `crk_csrf=${TOKEN}; ${session}`,
            'x-csrf-token': TOKEN,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status, `${method} ${path}`).toBeLessThan(300);
      return ((await res.json()) as { data: { id: string } }).data;
    };
    const about = await send('POST', '/v1/m/pages/pages', {
      title: 'About Us',
      slug: s('about-us'),
      status: 'published',
      summary: 'Who we are',
      body: 'Hello **world**',
    });
    await send('PUT', `/v1/m/pages/pages/${about.id}/slug`, { slug: s('about-our-company') });
    await send('PUT', `/v1/m/pages/pages/${about.id}/slug`, { slug: s('about-qhomemart') });
    const draft = await send('POST', '/v1/m/pages/pages', { title: 'Draft', slug: s('draft-a') });
    await send('PUT', `/v1/m/pages/pages/${draft.id}/slug`, { slug: s('draft-b') });
    console.info(`pages web check: run id ${run} (PAGES_WEB_KEEP=${run} re-checks these URLs)`);
  });

  afterAll(async () => {
    await settings.save(null, [{ key: 'app.not_found_route', value: globalBefore ?? '' }], {
      notFoundRoutes: globalBefore ? [globalBefore] : [],
    });
    await settings.save(tenantId, [{ key: 'app.not_found_route', value: override ?? '' }], {
      notFoundRoutes: override ? [override] : [],
    });
  });

  test('the current permalink answers 200 with the page, canonical at its own root URL', async () => {
    const res = await visit(`/${s('about-qhomemart')}`);
    const html = await res.text();
    expect(res.status, html.slice(0, 300)).toBe(200);
    expect(res.headers.get('x-not-found-route')).toBe('/pages');
    expect(html).toContain('data-testid="pages-article"');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain(`rel="canonical" href="${WEB}/${s('about-qhomemart')}"`);
  });

  test('every old permalink answers 301 straight to the current one', async () => {
    for (const old of [s('about-us'), s('about-our-company')]) {
      const res = await visit(`/${old}`);
      expect(res.status, `/${old}`).toBe(301);
      expect(res.headers.get('location'), `/${old}`).toBe(`${WEB}/${s('about-qhomemart')}`);
      // One hop: the target itself is the page, not another redirect.
      const target = await visit(new URL(res.headers.get('location') ?? '/').pathname);
      expect(target.status).toBe(200);
    }
  });

  test('the query string survives the redirect', async () => {
    const res = await visit(`/${s('about-us')}?utm_source=newsletter`);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      `${WEB}/${s('about-qhomemart')}?utm_source=newsletter`,
    );
  });

  test('a loosely written current URL is sent to its one exact form', async () => {
    const res = await visit(`/${s('About-Qhomemart').toUpperCase()}`);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${WEB}/${s('about-qhomemart')}`);
  });

  test('unknown slugs and renamed never-published drafts are plain 404s', async () => {
    for (const path of [`/${s('no-such-page')}`, `/${s('draft-a')}`, `/${s('draft-b')}`]) {
      const res = await visit(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('location'), path).toBeNull();
    }
  });

  test('a direct visit to the handler itself is 404', async () => {
    expect((await visit('/pages')).status).toBe(404);
  });

  test('a crawler-style request gets the same 301 (it asks for HTML)', async () => {
    const res = await fetch(`${WEB}/${s('about-our-company')}`, {
      redirect: 'manual',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${WEB}/${s('about-qhomemart')}`);
  });
});
