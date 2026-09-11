import { describe, expect, test } from 'bun:test';
import { app } from '../../src/app.ts';

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
});
