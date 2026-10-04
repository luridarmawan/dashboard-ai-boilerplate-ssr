import { describe, expect, test } from 'bun:test';
import { and, eq, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';
import { settings } from '../../src/services.ts';
import { sign } from '../../src/webhooks.ts';

/** Integration: the Example module's PUBLIC API answers anonymously (R-2, R-3). */
const enabled = process.env.INTEGRATION === '1';
describe.skipIf(!enabled)('Example public API', () => {
  test('GET /v1/m/example/products is public and returns the seeded storefront', async () => {
    const res = await app.handle(new Request('http://api.test/v1/m/example/products'));
    const body = await res.text();
    expect(res.status, body.slice(0, 300)).toBe(200);
    expect(body).toContain('gayo-arabika');
    const one = await app.handle(new Request('http://api.test/v1/m/example/products/gayo-arabika'));
    expect(one.status).toBe(200);
  });

  /** R-9: the catalogue arrangement asks the same endpoint to search and sort — server-side, so
   *  the page answers the same with JavaScript off. */
  test('products: ?q searches, ?sort/?order order, and both keep the public contract', async () => {
    const list = async (qs: string) => {
      const res = await app.handle(new Request(`http://api.test/v1/m/example/products${qs}`));
      expect(res.status).toBe(200);
      return (await res.json()) as {
        data: { name: string; price: number; featured: boolean }[];
        meta: { total: number };
      };
    };
    const all = await list('');
    const found = await list('?q=gayo');
    expect(found.data).toHaveLength(1);
    expect(found.data[0]?.name).toContain('Gayo');
    // `total` is what matched, not what exists — the page prints it as the result count.
    expect(found.meta.total).toBe(1);
    expect(await list('?q=tidakadaproduksepertiini').then((r) => r.data)).toHaveLength(0);

    const asc = await list('?sort=price&order=asc');
    const desc = await list('?sort=price&order=desc');
    expect(asc.data.map((p) => p.price)).toEqual(
      [...asc.data.map((p) => p.price)].sort((a, b) => a - b),
    );
    expect(desc.data[0]?.price).toBeGreaterThanOrEqual(asc.data[0]?.price ?? 0);
    // Unsorted stays the admin's merchandising order, exactly as the storefront had it.
    expect(all.data.length).toBe(asc.data.length);
    expect((await list('?featured=1')).data.every((p) => p.featured)).toBe(true);
  });

  /** F-11: the web's 404 trapper asks this endpoint whether a root URL is a category or a product. */
  test('GET /v1/m/example/resolve names a category, a product, or nothing (F-11)', async () => {
    const resolve = (path: string) =>
      app.handle(
        new Request(`http://api.test/v1/m/example/resolve?path=${encodeURIComponent(path)}`),
      );
    const cat = await resolve('/single-origin');
    expect(cat.status, await cat.clone().text()).toBe(200);
    const catBody = (await cat.json()) as {
      data: {
        kind: string;
        category: { slug: string; name: string };
        products: { slug: string }[];
      };
    };
    expect(catBody.data.kind).toBe('category');
    expect(catBody.data.products.map((p) => p.slug)).toContain('gayo-arabika');
    expect(catBody.data.products.map((p) => p.slug)).not.toContain('house-blend');
    // The trapper hands over the URL exactly as typed: trailing slash and case are ours to forgive.
    expect((await resolve('/Single-Origin/')).status).toBe(200);
    const prod = await resolve('/gayo-arabika');
    expect(prod.status).toBe(200);
    const prodBody = (await prod.json()) as {
      data: { kind: string; product: { slug: string }; category: { slug: string } | null };
    };
    expect(prodBody.data.kind).toBe('product');
    expect(prodBody.data.product.slug).toBe('gayo-arabika');
    expect(prodBody.data.category?.slug).toBe('single-origin');
    // Everything else is "not mine": deeper paths, the root, scanner noise, non-slugs.
    for (const path of ['/tidak-ada', '/single-origin/gayo-arabika', '/', '/wp-admin.php', '/a b'])
      expect((await resolve(path)).status, path).toBe(404);
  });

  /** F-11: root URLs exist only while the module answers unknown URLs — the sitemap follows. */
  test('sitemap lists root category/product URLs only while app.not_found_route is /resolve', async () => {
    // Save through the app's OWN settings service: with CACHE_DRIVER=redis a second store would
    // bump the database version while the app keeps reading its Redis copy until it expires.
    const store = settings;
    // The storefront is the DEFAULT tenant, and a tenant-scope override (an admin saving from
    // /settings in that scope) shadows the global value this test sets — clear it for the test
    // and put it back afterwards, so a shared dev database cannot turn this red.
    const [tenant] = await unsafeAcrossTenants()
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(eq(schema.clients.code, 'default'));
    const tid = tenant?.id ?? null;
    const [override] = await unsafeAcrossTenants()
      .select({ value: schema.configurations.value })
      .from(schema.configurations)
      .where(
        and(
          eq(schema.configurations.key, 'app.not_found_route'),
          tid ? eq(schema.configurations.client_id, tid) : undefined,
        ),
      );
    const sitemap = async () => {
      const res = await app.handle(new Request('http://api.test/v1/m/example/sitemap'));
      expect(res.status).toBe(200);
      return ((await res.json()) as { data: { path: string }[] }).data.map((e) => e.path);
    };
    try {
      if (tid) await store.save(tid, [{ key: 'app.not_found_route', value: '' }]);
      await store.save(null, [{ key: 'app.not_found_route', value: '' }]);
      const off = await sitemap();
      expect(off).toContain('/product/gayo-arabika');
      expect(off).not.toContain('/single-origin');
      expect(off).not.toContain('/gayo-arabika');
      const saved = await store.save(null, [{ key: 'app.not_found_route', value: '/resolve' }], {
        notFoundRoutes: ['/resolve'],
      });
      expect(saved.errors).toEqual({});
      const on = await sitemap();
      expect(on).toContain('/single-origin');
      expect(on).toContain('/gayo-arabika');
      expect(on).toContain('/product/gayo-arabika');
    } finally {
      await store.save(null, [{ key: 'app.not_found_route', value: '' }]);
      if (tid && override?.value)
        await store.save(tid, [{ key: 'app.not_found_route', value: override.value }], {
          notFoundRoutes: [override.value],
        });
    }
  });

  /**
   * R-5: the contact form answers the visitor twice — on the page, and in their inbox. The
   * acknowledgement is queued in the outbox like any other mail (J-1), addressed to the address
   * that was just submitted, and it does not depend on `example.contact_email` (that setting only
   * says where the inquiry is READ).
   */
  test('a contact inquiry queues a thank-you to the sender', async () => {
    const db = unsafeAcrossTenants();
    const stamp = Date.now();
    const email = `ack-${stamp}@example.test`;
    // Public, but state-changing: the CSRF pair travels like it does from the browser (§1.3 rule 6).
    const token = 'E'.repeat(43);
    const submit = (body: Record<string, unknown>, ip: string, locale?: string) =>
      app.handle(
        new Request('http://api.test/v1/m/example/inquiries', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://api.test',
            cookie: `crk_csrf=${token}`,
            'x-csrf-token': token,
            // Own IP per call: the form is rate limited 5/hour per address (R-5).
            'x-forwarded-for': ip,
            ...(locale ? { 'accept-language': locale } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    const res = await submit(
      { name: 'Siti', email, message: 'Halo, saya ingin memesan 10 kg untuk kantor kami.' },
      `10.73.${Math.floor(stamp / 1000) % 250}.${stamp % 250}`,
      'en',
    );
    expect([200, 201]).toContain(res.status);
    const [row] = await db
      .select()
      .from(schema.outboxEmail)
      .where(
        and(
          eq(schema.outboxEmail.to_address, email),
          eq(schema.outboxEmail.template, 'contact-ack'),
        ),
      );
    expect(row).toBeDefined();
    expect(row?.to_name).toBe('Siti');
    // Written in the language the form was submitted in, with the visitor's own words to quote back.
    expect(row?.locale).toBe('en');
    expect((row?.payload as { message?: string })?.message).toContain('10 kg');
    // The honeypot answers "received" and stores nothing — that includes the thank-you.
    const bot = `ack-bot-${stamp}@example.test`;
    await submit(
      {
        name: 'Bot',
        email: bot,
        message: 'buy cheap things now please click here',
        website: 'http://spam.example',
      },
      `10.74.${Math.floor(stamp / 1000) % 250}.${stamp % 250}`,
    );
    const botRows = await db
      .select()
      .from(schema.outboxEmail)
      .where(eq(schema.outboxEmail.to_address, bot));
    expect(botRows).toHaveLength(0);
  });

  /**
   * Extension point 17: an external system posts an inquiry with no CSRF pair and from a foreign
   * origin. The route is declared in modules/Example/csrf-exempt.ts; the HMAC signature is the
   * only thing that lets it in.
   */
  test('inbound inquiries: no CSRF needed, but the signature is', async () => {
    const db = unsafeAcrossTenants();
    const [tenant] = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(eq(schema.clients.code, 'default'));
    const tid = tenant?.id ?? null;
    expect(tid).not.toBeNull();
    const secret = `inbound-secret-${Date.now()}`;
    const post = (raw: string, headers: Record<string, string>) =>
      app.handle(
        new Request('http://api.test/v1/m/example/inbound/inquiries', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://partner.example',
            ...headers,
          },
          body: raw,
        }),
      );
    const signed = async (raw: string, ts = Math.floor(Date.now() / 1000)) =>
      post(raw, {
        'x-example-timestamp': String(ts),
        'x-example-signature': await sign(secret, String(ts), raw),
      });
    const email = `inbound-${Date.now()}@example.test`;
    const raw = JSON.stringify({
      name: 'Sistem Mitra',
      email,
      message: 'Pesanan grosir 50 kg dari portal mitra.',
      source: 'partner-portal',
    });
    try {
      // Saved in the tenant scope: a tenant override would shadow a global value.
      const saved = await settings.save(tid, [{ key: 'example.inbound_secret', value: secret }]);
      expect(saved.errors).toEqual({});

      const unsigned = await post(raw, {});
      expect(unsigned.status).toBe(401);
      expect(((await unsigned.json()) as { error: { code: string } }).error.code).toBe(
        'unauthorized',
      );
      const ts = Math.floor(Date.now() / 1000);
      const forged = await post(raw, {
        'x-example-timestamp': String(ts),
        'x-example-signature': await sign('wrong-secret', String(ts), raw),
      });
      expect(forged.status).toBe(401);
      expect((await signed(raw, ts - 600)).status).toBe(401); // outside the replay window
      expect((await signed('{"name":"x"}')).status).toBe(422); // signed, but not an inquiry

      const res = await signed(raw);
      expect(res.status, await res.clone().text()).toBe(201);
      const id = ((await res.json()) as { data: { id: string } }).data.id;
      const [row] = await db
        .select()
        .from(schema.exampleInquiries)
        .where(eq(schema.exampleInquiries.id, id));
      expect(row?.email).toBe(email);
      expect(row?.source).toBe('partner-portal');
      expect(row?.client_id ?? null).toBe(tid);
    } finally {
      await settings.save(tid, [{ key: 'example.inbound_secret', value: '__clear__' }]);
    }
    // No secret, no endpoint — even a correctly signed request is refused.
    expect((await signed(raw)).status).toBe(503);
  });
});
