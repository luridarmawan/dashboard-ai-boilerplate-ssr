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
});
