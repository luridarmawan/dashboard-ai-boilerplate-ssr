import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { settings } from '@app/api/services';
import { runSeed } from '@core/auth';
import { and, eq, newId, schema, unsafeAcrossTenants } from '@core/db';

/**
 * The Pages API against the real app (INTEGRATION=1): CRUD, and every rule of the permalink
 * history — 301 targets, no chains, no loops, no redirect for drafts, conflicts, the transaction
 * that keeps a slug change and its redirect together, deletion. The HTTP 301 itself is answered
 * by the web (SvelteKit); `test/web/redirects.test.ts` checks it over real HTTP.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const email = `pages-${run}@example.test`;
const password = 'a generated module password';
/** Run-unique slugs: the dev database is shared and rows of earlier runs stay behind. */
const s = (name: string) => `p${run}-${name}`;

type Envelope = {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; details?: { reason?: string } };
};
type Detail = { id: string; slug: string; status: string; redirects: { oldSlug: string }[] };

let admin = '';
let tenantId = '';
const call = (path: string, init: RequestInit = {}, cookies: string[] = [admin]) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', `10.98.${Math.floor(run / 1000) % 250}.${run % 250}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const send = async (method: string, path: string, body?: unknown) => {
  const res = await call(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as Envelope };
};
const create = async (body: Record<string, unknown>) => {
  const r = await send('POST', '/v1/m/pages/pages', body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as unknown as Detail;
};
const rename = (id: string, slug: string) => send('PUT', `/v1/m/pages/pages/${id}/slug`, { slug });
const detail = async (id: string) =>
  (await send('GET', `/v1/m/pages/pages/${id}`)).body.data as unknown as Detail;
/** Anonymous, like the web's 404 handler on behalf of a visitor (default tenant). */
const resolve = async (path: string) => {
  const res = await app.handle(
    new Request(`${ORIGIN}/v1/m/pages/resolve?path=${encodeURIComponent(path)}`),
  );
  const body = (await res.json()) as {
    data?:
      | { kind: 'page'; page: { slug: string; html: string } }
      | { kind: 'redirect'; location: string };
  };
  return { status: res.status, data: body.data };
};
const expectPage = async (slug: string) => {
  const r = await resolve(`/${slug}`);
  expect(r.status, `/${slug}`).toBe(200);
  expect(r.data?.kind === 'page' && r.data.page.slug).toBe(slug);
};
const expectRedirect = async (from: string, to: string) => {
  const r = await resolve(`/${from}`);
  expect(r.status, `/${from}`).toBe(200);
  expect(r.data, `/${from}`).toEqual({ kind: 'redirect', location: `/${to}` });
};
const expectNothing = async (slug: string) => {
  expect((await resolve(`/${slug}`)).status, `/${slug}`).toBe(404);
};

describe.skipIf(!enabled)('Pages module', () => {
  beforeAll(async () => {
    if (!enabled) return;
    const seeded = await runSeed(unsafeAcrossTenants(), {
      adminEmail: email,
      adminPassword: password,
    });
    tenantId = seeded.tenantId;
    const res = await call(
      '/v1/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
      [],
    );
    admin =
      res.headers
        .getSetCookie()
        .find((c) => c.startsWith('crk_session='))
        ?.split(';')[0] ?? '';
  });

  test('CRUD, and the admin API is not public', async () => {
    const page = await create({ title: 'Contoh halaman', slug: s('crud'), body: '# Hi' });
    expect(page.status).toBe('draft');
    expect((await send('GET', `/v1/m/pages/pages/${page.id}`)).status).toBe(200);
    const list = await send('GET', `/v1/m/pages/pages?q=${s('crud')}`);
    expect((list.body.data as unknown as { id: string }[]).map((r) => r.id)).toEqual([page.id]);
    expect((await send('PUT', `/v1/m/pages/pages/${page.id}`, { title: 'Diubah' })).status).toBe(
      200,
    );
    expect((await send('DELETE', `/v1/m/pages/pages/${page.id}`)).status).toBe(200);
    expect((await send('GET', `/v1/m/pages/pages/${page.id}`)).status).toBe(404);
    expect((await call('/v1/m/pages/pages', {}, [])).status).toBe(401);
  });

  test('an empty slug is derived from the title', async () => {
    const page = await create({ title: `Tentang Kami ${run}` });
    expect(page.slug).toBe(`tentang-kami-${run}`);
  });

  test('a published page resolves; a draft and an unknown slug do not', async () => {
    const pub = await create({
      title: 'Published',
      slug: s('pub'),
      status: 'published',
      body: '**x**',
    });
    await create({ title: 'Draft', slug: s('draft') });
    const r = await resolve(`/${pub.slug}`);
    expect(r.status).toBe(200);
    expect(r.data?.kind === 'page' && r.data.page.html).toContain('<strong>x</strong>');
    await expectNothing(s('draft'));
    await expectNothing(s('never-existed'));
  });

  test('renaming a published page: old → 301 target, new → page; again: no chain', async () => {
    const page = await create({ title: 'About', slug: s('about-us'), status: 'published' });
    const first = await rename(page.id, s('about-our-company'));
    expect(first.status).toBe(200);
    expect((first.body.data as { change: unknown }).change).toEqual({
      changed: true,
      redirected: true,
      from: s('about-us'),
      to: s('about-our-company'),
    });
    await expectRedirect(s('about-us'), s('about-our-company'));
    await expectPage(s('about-our-company'));

    expect((await rename(page.id, s('about-qhomemart'))).status).toBe(200);
    // Every old permalink points straight at the CURRENT one — never at the previous hop.
    await expectRedirect(s('about-us'), s('about-qhomemart'));
    await expectRedirect(s('about-our-company'), s('about-qhomemart'));
    await expectPage(s('about-qhomemart'));
    expect((await detail(page.id)).redirects.map((r) => r.oldSlug)).toEqual([
      s('about-us'),
      s('about-our-company'),
    ]);

    // The same slug again changes nothing and writes no redirect onto itself.
    const same = await rename(page.id, s('about-qhomemart'));
    expect((same.body.data as { change: { changed: boolean } }).change.changed).toBe(false);
    expect((await detail(page.id)).redirects).toHaveLength(2);

    // The redirect rows are plain database rows: nothing about them lives in process memory, so
    // a restarted server answers the same (the web check repeats this over HTTP).
    const rows = await unsafeAcrossTenants()
      .select({ old: schema.pagesRedirects.old_slug })
      .from(schema.pagesRedirects)
      .where(eq(schema.pagesRedirects.page_id, page.id));
    expect(rows.map((r) => r.old).sort()).toEqual([s('about-our-company'), s('about-us')]);
  });

  test('renaming back to an own old slug reclaims it: no loop, no self-redirect', async () => {
    const page = await create({ title: 'Loop', slug: s('loop-a'), status: 'published' });
    await rename(page.id, s('loop-b'));
    await rename(page.id, s('loop-c'));
    expect((await rename(page.id, s('loop-a'))).status).toBe(200);
    await expectPage(s('loop-a'));
    await expectRedirect(s('loop-b'), s('loop-a'));
    await expectRedirect(s('loop-c'), s('loop-a'));
    const redirects = (await detail(page.id)).redirects.map((r) => r.oldSlug);
    expect(redirects).not.toContain(s('loop-a'));
    expect(redirects.sort()).toEqual([s('loop-b'), s('loop-c')]);
  });

  test('a draft that was never published leaves no redirect behind', async () => {
    const page = await create({ title: 'Draft', slug: s('draft-old') });
    const r = await rename(page.id, s('draft-new'));
    expect((r.body.data as { change: { redirected: boolean } }).change.redirected).toBe(false);
    expect((await detail(page.id)).redirects).toEqual([]);
    await expectNothing(s('draft-old'));
    // Publishing and renaming in ONE save: the old slug was never public, so still no redirect.
    const both = await send('PUT', `/v1/m/pages/pages/${page.id}`, {
      slug: s('draft-final'),
      status: 'published',
    });
    expect(both.status).toBe(200);
    expect((both.body.data as unknown as Detail).redirects).toEqual([]);
    await expectPage(s('draft-final'));
    await expectNothing(s('draft-new'));
  });

  test('slug conflicts are refused and leave both pages and their redirects as they were', async () => {
    const a = await create({ title: 'A', slug: s('conf-a1'), status: 'published' });
    await rename(a.id, s('conf-a2'));
    const b = await create({ title: 'B', slug: s('conf-b'), status: 'published' });

    const onPage = await rename(b.id, s('conf-a2'));
    expect(onPage.status).toBe(409);
    expect(onPage.body.error?.details?.reason).toBe('slug_taken');
    const onRedirect = await rename(b.id, s('conf-a1'));
    expect(onRedirect.status).toBe(409);
    expect(onRedirect.body.error?.details?.reason).toBe('slug_redirected');
    const created = await send('POST', '/v1/m/pages/pages', { title: 'C', slug: s('conf-a1') });
    expect(created.status).toBe(409);
    expect(created.body.error?.details?.reason).toBe('slug_redirected');
    expect((await send('PUT', `/v1/m/pages/pages/${b.id}`, { slug: s('conf-a2') })).status).toBe(
      409,
    );

    expect((await detail(b.id)).slug).toBe(s('conf-b'));
    expect((await detail(b.id)).redirects).toEqual([]);
    expect((await detail(a.id)).redirects.map((r) => r.oldSlug)).toEqual([s('conf-a1')]);
    await expectRedirect(s('conf-a1'), s('conf-a2'));
    await expectPage(s('conf-b'));
  });

  test('a redirect that cannot be written rolls the slug change back (one transaction)', async () => {
    const page = await create({ title: 'Tx', slug: s('tx-old'), status: 'published' });
    // Plant a row that makes the redirect insert fail on the unique index, the way a racing
    // request would: the slug update before it already ran inside the same transaction.
    const planted = newId();
    await unsafeAcrossTenants()
      .insert(schema.pagesRedirects)
      .values({ id: planted, client_id: tenantId, page_id: newId(), old_slug: s('tx-old') });
    try {
      const r = await rename(page.id, s('tx-new'));
      expect(r.status).toBe(409);
      expect(r.body.error?.details?.reason).toBe('slug_race');
      expect((await detail(page.id)).slug).toBe(s('tx-old'));
      expect((await detail(page.id)).redirects).toEqual([]);
      await expectNothing(s('tx-new'));
    } finally {
      await unsafeAcrossTenants()
        .delete(schema.pagesRedirects)
        .where(eq(schema.pagesRedirects.id, planted));
    }
    // With the obstacle gone the same change goes through, redirect included.
    expect((await rename(page.id, s('tx-new'))).status).toBe(200);
    await expectRedirect(s('tx-old'), s('tx-new'));
  });

  test('redirects follow the page: off while it is a draft, gone (and free) once it is deleted', async () => {
    const page = await create({ title: 'Gone', slug: s('gone-a'), status: 'published' });
    await rename(page.id, s('gone-b'));
    await expectRedirect(s('gone-a'), s('gone-b'));

    await send('PUT', `/v1/m/pages/pages/${page.id}`, { status: 'draft' });
    await expectNothing(s('gone-a'));
    await expectNothing(s('gone-b'));
    await send('PUT', `/v1/m/pages/pages/${page.id}`, { status: 'published' });
    await expectRedirect(s('gone-a'), s('gone-b'));

    expect((await send('DELETE', `/v1/m/pages/pages/${page.id}`)).status).toBe(200);
    await expectNothing(s('gone-a'));
    await expectNothing(s('gone-b'));
    const left = await unsafeAcrossTenants()
      .select()
      .from(schema.pagesRedirects)
      .where(
        and(
          eq(schema.pagesRedirects.client_id, tenantId),
          eq(schema.pagesRedirects.page_id, page.id),
        ),
      );
    expect(left).toEqual([]);
    // Both the current and the old slug are free for a new page.
    await create({ title: 'New', slug: s('gone-a'), status: 'published' });
    await create({ title: 'New', slug: s('gone-b'), status: 'published' });
    await expectPage(s('gone-a'));
  });

  describe('sitemap', () => {
    let override: string | null = null;
    beforeAll(async () => {
      const [row] = await unsafeAcrossTenants()
        .select({ value: schema.configurations.value })
        .from(schema.configurations)
        .where(
          and(
            eq(schema.configurations.key, 'app.not_found_route'),
            eq(schema.configurations.client_id, tenantId),
          ),
        );
      override = row?.value ?? null;
    });
    afterAll(async () => {
      await settings.save(null, [{ key: 'app.not_found_route', value: '' }]);
      await settings.save(tenantId, [{ key: 'app.not_found_route', value: override ?? '' }], {
        notFoundRoutes: override ? [override] : [],
      });
    });
    const sitemap = async () => {
      const res = await app.handle(new Request(`${ORIGIN}/v1/m/pages/sitemap`));
      return ((await res.json()) as { data: { path: string }[] }).data.map((e) => e.path);
    };

    test('lists published pages only while the module answers root URLs', async () => {
      await create({ title: 'Map', slug: s('map-pub'), status: 'published' });
      await create({ title: 'Map', slug: s('map-draft') });
      await settings.save(tenantId, [{ key: 'app.not_found_route', value: '' }]);
      await settings.save(null, [{ key: 'app.not_found_route', value: '' }]);
      expect(await sitemap()).not.toContain(`/${s('map-pub')}`);
      const saved = await settings.save(null, [{ key: 'app.not_found_route', value: '/pages' }], {
        notFoundRoutes: ['/pages'],
      });
      expect(saved.errors).toEqual({});
      const on = await sitemap();
      expect(on).toContain(`/${s('map-pub')}`);
      expect(on).not.toContain(`/${s('map-draft')}`);
    });
  });
});
