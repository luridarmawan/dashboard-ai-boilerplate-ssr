import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { storeUpload } from '@app/api/files';
import { settings } from '@app/api/services';
import { runSeed } from '@core/auth';
import { eq, schema, unsafeAcrossTenants } from '@core/db';
import { makePng } from '../fixtures/png.ts';

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
  let shareBefore = { global: '', tenant: '' };

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
    const shareRows = await unsafeAcrossTenants()
      .select({ value: schema.configurations.value, client: schema.configurations.client_id })
      .from(schema.configurations)
      .where(eq(schema.configurations.key, 'app.share_image'));
    shareBefore = {
      global: shareRows.find((r) => r.client === null)?.value ?? '',
      tenant: shareRows.find((r) => r.client === tenantId)?.value ?? '',
    };
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
    // A featured image for the link preview (og:image), uploaded as the dashboard does.
    const form = new FormData();
    form.append('file', new File([makePng(1200, 630)], 'hero.png', { type: 'image/png' }));
    form.append('alt', 'Our office');
    const uploaded = await app.handle(
      new Request(`${ORIGIN}/v1/m/pages/pages/${about.id}/image`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: `crk_csrf=${TOKEN}; ${session}`, 'x-csrf-token': TOKEN },
        body: form,
      }),
    );
    expect(uploaded.status).toBe(200);
    await send('POST', '/v1/m/pages/pages', {
      title: 'Plain',
      slug: s('plain'),
      status: 'published',
      body: 'No picture of its own.',
    });
    const draft = await send('POST', '/v1/m/pages/pages', { title: 'Draft', slug: s('draft-a') });
    await send('PUT', `/v1/m/pages/pages/${draft.id}/slug`, { slug: s('draft-b') });
    console.info(`pages web check: run id ${run} (PAGES_WEB_KEEP=${run} re-checks these URLs)`);
  });

  afterAll(async () => {
    await settings.save(null, [{ key: 'app.share_image', value: shareBefore.global }]);
    await settings.save(tenantId, [{ key: 'app.share_image', value: shareBefore.tenant }]);
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

  test('the share card: an absolute og:image a crawler can fetch, with size, type and alt', async () => {
    const html = await (await visit(`/${s('about-qhomemart')}`)).text();
    const meta = (prop: string) =>
      new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html)?.[1] ?? null;
    const og = meta('og:image');
    expect(og).toMatch(
      new RegExp(`^${WEB.replace(/[.:/]/g, '\\$&')}/v1/m/pages/media/[0-9a-f-]{36}$`),
    );
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('630');
    expect(meta('og:image:type')).toBe('image/png');
    expect(meta('og:image:alt')).toBe('Our office');
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('twitter:image')).toBe(og);
    expect(html).toContain('data-testid="pages-featured"');
    // Fetched like a crawler does: no cookie, no tenant header, through the site's own origin.
    const img = await fetch(og ?? '', { headers: { 'user-agent': 'facebookexternalhit/1.1' } });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
  });

  test('a page without a featured image shares with the default share image', async () => {
    const metaOf = async (path: string) => {
      const html = await (await visit(path)).text();
      return {
        html,
        meta: (prop: string) =>
          new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html)?.[1] ?? null,
      };
    };
    const clear = async () => {
      await settings.save(tenantId, [{ key: 'app.share_image', value: '' }]);
      await settings.save(null, [{ key: 'app.share_image', value: '' }]);
    };

    // Nothing set in Settings: the file the deploy ships.
    await clear();
    const plain = await metaOf(`/${s('plain')}`);
    expect(plain.meta('og:image')).toBe(`${WEB}/og-image.jpg`);
    expect(plain.meta('og:image:type')).toBe('image/jpeg');
    expect(plain.meta('og:image:width')).toBe('1672');
    expect(plain.meta('og:image:height')).toBe('941');
    expect(plain.meta('og:image:alt')).toBe('Plain');
    expect(plain.meta('twitter:card')).toBe('summary_large_image');
    // The default only illustrates the link: the article itself shows no picture.
    expect(plain.html).not.toContain('data-testid="pages-featured"');
    const shipped = await fetch(`${WEB}/og-image.jpg`, {
      headers: { 'user-agent': 'facebookexternalhit/1.1' },
    });
    expect(shipped.status).toBe(200);
    expect(shipped.headers.get('content-type')).toContain('image/jpeg');

    // Settings → Application → Default share image (global, what anonymous visitors read).
    const stored = await storeUpload({
      clientId: tenantId,
      userId: null,
      file: new File([makePng(1200, 630, [20, 140, 90])], 'share.png', { type: 'image/png' }),
      kind: 'setting-image',
      visibility: 'public',
    });
    if (!stored.ok) throw new Error(stored.message);
    try {
      await settings.save(null, [{ key: 'app.share_image', value: stored.row.id }]);
      const url = `${WEB}/v1/configuration/image-file/${stored.row.id}`;
      for (const path of [`/${s('plain')}`, '/']) {
        const page = await metaOf(path);
        expect(page.meta('og:image'), path).toBe(url);
        expect(page.meta('og:image:type'), path).toBe('image/png');
        expect(page.meta('og:image:width'), path).toBe('1200');
        expect(page.meta('og:image:height'), path).toBe('630');
        expect(page.meta('twitter:image'), path).toBe(url);
      }
      // A page WITH a featured image keeps its own.
      expect((await metaOf(`/${s('about-qhomemart')}`)).meta('og:image')).toContain(
        '/v1/m/pages/media/',
      );
      // Fetched like a crawler: no cookie, no tenant header, through the site's origin.
      const img = await fetch(url, { headers: { 'user-agent': 'facebookexternalhit/1.1' } });
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/png');
    } finally {
      await clear();
    }
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
