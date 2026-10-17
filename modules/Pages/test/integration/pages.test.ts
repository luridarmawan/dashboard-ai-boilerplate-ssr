import { beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { claimPermalink, releasePermalinks } from '@app/api/permalinks';
import { runSeed } from '@core/auth';
import { and, eq, inTransaction, newId, schema, unsafeAcrossTenants } from '@core/db';
import { makePng } from '../fixtures/png.ts';

/**
 * The Pages API against the real app (INTEGRATION=1): CRUD, and every rule of the permalink
 * history — 301 targets, no chains, no loops, no redirect for drafts, conflicts, the transaction
 * that keeps a slug change and its redirect together, deletion. The HTTP 301 itself is answered
 * by the web (SvelteKit); `test/web/redirects.test.ts` checks it over real HTTP. Also the
 * featured image: upload through core storage, its public media URL (og:image), replacement,
 * removal and the types social networks cannot show.
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
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
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

    // The history lives in the core permalink registry — plain database rows, nothing in process
    // memory, so a restarted server answers the same (the web check repeats this over HTTP).
    const rows = await unsafeAcrossTenants()
      .select({ path: schema.permalinks.path, kind: schema.permalinks.kind })
      .from(schema.permalinks)
      .where(and(eq(schema.permalinks.module, 'pages'), eq(schema.permalinks.target, page.id)));
    expect(rows.map((r) => `${r.kind} ${r.path}`).sort()).toEqual([
      `canonical /${s('about-qhomemart')}`,
      `redirect /${s('about-our-company')}`,
      `redirect /${s('about-us')}`,
    ]);
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

  test('a page write that fails rolls the permalink change back (one transaction)', async () => {
    const page = await create({ title: 'Tx', slug: s('tx-old'), status: 'published' });
    // Plant a deleted page still holding the new slug: the registry claim goes through, then the
    // page's own slug update hits the unique index — inside the same transaction, the way a racing
    // request would.
    const planted = newId();
    await unsafeAcrossTenants()
      .insert(schema.pagesPages)
      .values({
        id: planted,
        client_id: tenantId,
        title: 'Planted',
        slug: s('tx-new'),
        status: 'draft',
        deleted_at: new Date(),
      });
    try {
      const r = await rename(page.id, s('tx-new'));
      expect(r.status).toBe(409);
      expect(r.body.error?.details?.reason).toBe('slug_race');
      expect((await detail(page.id)).slug).toBe(s('tx-old'));
      expect((await detail(page.id)).redirects).toEqual([]);
      await expectNothing(s('tx-new'));
      const registry = await unsafeAcrossTenants()
        .select({ path: schema.permalinks.path, kind: schema.permalinks.kind })
        .from(schema.permalinks)
        .where(and(eq(schema.permalinks.module, 'pages'), eq(schema.permalinks.target, page.id)));
      expect(registry).toEqual([{ path: `/${s('tx-old')}`, kind: 'canonical' }]);
    } finally {
      await unsafeAcrossTenants()
        .delete(schema.pagesPages)
        .where(eq(schema.pagesPages.id, planted));
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
      .from(schema.permalinks)
      .where(
        and(
          eq(schema.permalinks.client_id, tenantId),
          eq(schema.permalinks.module, 'pages'),
          eq(schema.permalinks.target, page.id),
        ),
      );
    expect(left).toEqual([]);
    // Both the current and the old slug are free for a new page.
    await create({ title: 'New', slug: s('gone-a'), status: 'published' });
    await create({ title: 'New', slug: s('gone-b'), status: 'published' });
    await expectPage(s('gone-a'));
  });

  describe('the core permalink registry', () => {
    const core = async (path: string) => {
      const res = await app.handle(
        new Request(`${ORIGIN}/v1/permalinks/resolve?path=${encodeURIComponent(path)}`),
      );
      return { status: res.status, data: ((await res.json()) as { data?: unknown }).data };
    };

    test('resolves a page with no setting at all: content, redirect, loose spelling, nothing', async () => {
      const page = await create({ title: 'Core', slug: s('core-a'), status: 'published' });
      await rename(page.id, s('core-b'));
      expect(await core(`/${s('core-b')}`)).toEqual({
        status: 200,
        data: { kind: 'content', module: 'pages', page: '/pages', path: `/${s('core-b')}` },
      });
      expect(await core(`/${s('core-a')}`)).toEqual({
        status: 200,
        data: { kind: 'redirect', module: 'pages', location: `/${s('core-b')}` },
      });
      // A loose spelling resolves to the canonical path; the web answers 301 to it.
      expect((await core(`/${s('Core-B').toUpperCase()}/`)).data).toMatchObject({
        path: `/${s('core-b')}`,
      });
      expect((await core(`/${s('core-nothing')}`)).status).toBe(404);
      expect((await core('/wp-login.php')).status).toBe(404);
    });

    test('sitemap lists live pages only', async () => {
      await create({ title: 'Map', slug: s('map-pub'), status: 'published' });
      await create({ title: 'Map', slug: s('map-draft') });
      const res = await app.handle(new Request(`${ORIGIN}/v1/permalinks/sitemap`));
      const paths = ((await res.json()) as { data: { path: string }[] }).data.map((e) => e.path);
      expect(paths).toContain(`/${s('map-pub')}`);
      expect(paths).not.toContain(`/${s('map-draft')}`);
    });

    test('a URL is unique across modules: another module holding it blocks a page', async () => {
      // Another module (an articles module, say) registered this URL for its own content.
      const other = newId();
      await inTransaction(tenantId, (tx) =>
        claimPermalink(tx, {
          module: 'articles',
          target: other,
          path: `/${s('shared')}`,
          live: true,
          keepHistory: false,
        }),
      );
      try {
        const r = await send('POST', '/v1/m/pages/pages', { title: 'Shared', slug: s('shared') });
        expect(r.status).toBe(409);
        expect(r.body.error?.details).toMatchObject({ reason: 'slug_taken', module: 'articles' });
        // …and Pages never answers for it: the URL is not ours.
        expect((await resolve(`/${s('shared')}`)).status).toBe(404);
      } finally {
        await inTransaction(tenantId, (tx) => releasePermalinks(tx, 'articles', other));
      }
    });

    test('slugs the app itself answers are refused', async () => {
      for (const slug of ['dashboard', 'settings', 'pages', 'example']) {
        const r = await send('POST', '/v1/m/pages/pages', { title: 'Reserved', slug });
        expect(r.status, slug).toBe(409);
        expect(r.body.error?.details?.reason, slug).toBe('slug_reserved');
      }
    });
  });

  describe('featured image', () => {
    type Img = {
      url: string;
      width: number | null;
      height: number | null;
      mime: string;
      alt: string | null;
    };
    const upload = async (
      id: string,
      bytes: Uint8Array,
      type: string,
      name: string,
      alt?: string,
    ) => {
      const form = new FormData();
      form.append('file', new File([bytes], name, { type }));
      if (alt !== undefined) form.append('alt', alt);
      const res = await app.handle(
        new Request(`${ORIGIN}/v1/m/pages/pages/${id}/image`, {
          method: 'POST',
          body: form,
          headers: {
            origin: ORIGIN,
            cookie: `crk_csrf=${TOKEN}; ${admin}`,
            'x-csrf-token': TOKEN,
          },
        }),
      );
      return { status: res.status, body: (await res.json()) as Envelope };
    };
    const media = (url: string) => app.handle(new Request(`${ORIGIN}${url}`));
    const imageOf = async (id: string) =>
      ((await send('GET', `/v1/m/pages/pages/${id}`)).body.data as { image: Img | null }).image;
    const publicImage = async (slug: string) => {
      const r = await resolve(`/${slug}`);
      return r.data?.kind === 'page'
        ? (r.data.page as unknown as { image: Img | null }).image
        : null;
    };
    const fileRow = async (url: string) => {
      const id = /\/([0-9a-f-]{36})\//.exec(`${url}/`)?.[1] ?? '';
      const [row] = await unsafeAcrossTenants()
        .select({
          deleted: schema.files.deleted_at,
          kind: schema.files.kind,
          visibility: schema.files.visibility,
        })
        .from(schema.files)
        .where(eq(schema.files.id, id));
      return row;
    };

    test('upload: stored public, sized, served to anonymous visitors only while published', async () => {
      const page = await create({ title: 'Gambar', slug: s('img'), summary: 'Ringkas' });
      const up = await upload(page.id, makePng(1200, 630), 'image/png', 'hero.png', 'Kantor kami');
      expect(up.status, JSON.stringify(up.body)).toBe(200);
      const admin = await imageOf(page.id);
      expect(admin).toMatchObject({
        width: 1200,
        height: 630,
        mime: 'image/png',
        alt: 'Kantor kami',
      });
      expect(await fileRow(admin?.url ?? '')).toMatchObject({
        kind: 'pages.featured',
        visibility: 'public',
        deleted: null,
      });

      // Draft: the page does not resolve and its image is not served.
      const mediaUrl = `/v1/m/pages/media/${/([0-9a-f-]{36})/.exec(admin?.url ?? '')?.[1]}`;
      expect((await media(mediaUrl)).status).toBe(404);

      await send('PUT', `/v1/m/pages/pages/${page.id}`, { status: 'published' });
      const pub = await publicImage(s('img'));
      expect(pub).toEqual({
        url: mediaUrl,
        width: 1200,
        height: 630,
        mime: 'image/png',
        alt: 'Kantor kami',
      });
      // Anonymous, no X-Client-ID — exactly what a social crawler sends.
      const got = await media(mediaUrl);
      expect(got.status).toBe(200);
      expect(got.headers.get('content-type')).toBe('image/png');
      expect(got.headers.get('cache-control')).toContain('public');
      expect(new Uint8Array(await got.arrayBuffer()).slice(0, 4)).toEqual(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      );

      // Alt text alone is editable without a new upload; empty clears it.
      await send('PUT', `/v1/m/pages/pages/${page.id}`, { imageAlt: 'Tim kami' });
      expect((await imageOf(page.id))?.alt).toBe('Tim kami');
    });

    test('replace removes the old file; remove clears the page and its media URL', async () => {
      const page = await create({ title: 'Ganti', slug: s('img-swap'), status: 'published' });
      await upload(page.id, makePng(800, 420), 'image/png', 'a.png');
      const first = await imageOf(page.id);
      await upload(page.id, makePng(1200, 630, [10, 120, 200]), 'image/png', 'b.png');
      const second = await imageOf(page.id);
      expect(second?.url).not.toBe(first?.url);
      expect((await fileRow(first?.url ?? ''))?.deleted).not.toBeNull();
      expect(second?.width).toBe(1200);

      const removed = await send('DELETE', `/v1/m/pages/pages/${page.id}/image`);
      expect(removed.status).toBe(200);
      expect(await imageOf(page.id)).toBeNull();
      expect(await publicImage(s('img-swap'))).toBeNull();
      expect((await fileRow(second?.url ?? ''))?.deleted).not.toBeNull();
    });

    test('formats social networks cannot show are refused, and nothing changes', async () => {
      const page = await create({ title: 'Tolak', slug: s('img-bad'), status: 'published' });
      const svg = await upload(
        page.id,
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        'image/svg+xml',
        'x.svg',
      );
      expect(svg.status).toBe(422);
      expect(svg.body.error?.details?.reason).toBe('type_not_allowed');
      const fake = await upload(
        page.id,
        new TextEncoder().encode('not a png'),
        'image/png',
        'x.png',
      );
      expect(fake.status).toBe(422);
      expect(fake.body.error?.details?.reason).toBe('content_mismatch');
      expect(await imageOf(page.id)).toBeNull();
      // Anonymous with a perfectly valid image: refused by permission, not by content.
      const anon = new FormData();
      anon.append('file', new File([makePng(10, 10)], 'a.png', { type: 'image/png' }));
      expect(
        (await call(`/v1/m/pages/pages/${page.id}/image`, { method: 'POST', body: anon }, []))
          .status,
      ).toBe(401);
    });

    test('deleting the page deletes its image', async () => {
      const page = await create({ title: 'Hapus', slug: s('img-del'), status: 'published' });
      await upload(page.id, makePng(1200, 630), 'image/png', 'c.png');
      const img = await imageOf(page.id);
      await send('DELETE', `/v1/m/pages/pages/${page.id}`);
      expect((await fileRow(img?.url ?? ''))?.deleted).not.toBeNull();
    });
  });
});
