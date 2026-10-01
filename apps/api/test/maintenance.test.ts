import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resetEnvCache } from '@core/config';
import { app } from '../src/app.ts';
import { maintenanceAllows } from '../src/plugins/maintenance.ts';

/**
 * Maintenance mode, the `.env` switch (E-10), without a database: anonymous requests are refused
 * with 503 `maintenance` everywhere except the allow-list the sign-in and maintenance pages need.
 * The Settings switch and the Administrator exemption need rows — see integration/maintenance.test.ts.
 */
const ORIGIN = 'http://api.test';
const previous = process.env.MAINTENANCE_MODE;

const get = (path: string) => app.handle(new Request(`${ORIGIN}${path}`));

describe('maintenance mode — MAINTENANCE_MODE=true (E-10)', () => {
  beforeAll(() => {
    process.env.MAINTENANCE_MODE = 'true';
    resetEnvCache();
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = previous;
    resetEnvCache();
  });

  test('anonymous requests outside the allow-list answer 503 `maintenance` with Retry-After', async () => {
    const res = await get('/v1/users');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('300');
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; details: unknown };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('maintenance');
    expect(body.error.details).toEqual({ source: 'env' });
    // The API docs are closed too: the whole deployment is.
    expect((await get('/openapi.json')).status).toBe(503);
  });

  test('liveness and the sign-in flow stay reachable', async () => {
    expect((await get('/v1/version')).status).toBe(200);
    // The gate lets the login through; the route itself then validates the body (422, not 503).
    const login = await app.handle(
      new Request(`${ORIGIN}/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: '{}',
      }),
    );
    expect(login.status).not.toBe(503);
  });

  test('the allow-list is exact per path and method', () => {
    expect(maintenanceAllows('GET', '/v1/health')).toBe(true);
    expect(maintenanceAllows('GET', '/v1/auth/me')).toBe(true);
    expect(maintenanceAllows('HEAD', '/v1/auth/me')).toBe(true);
    expect(maintenanceAllows('POST', '/v1/auth/login')).toBe(true);
    expect(maintenanceAllows('POST', '/v1/auth/logout')).toBe(true);
    expect(maintenanceAllows('GET', '/v1/configuration/public')).toBe(true);
    expect(maintenanceAllows('GET', '/v1/themes/custom')).toBe(true);
    // Writes to the same resources are not sign-in needs.
    expect(maintenanceAllows('POST', '/v1/themes/custom')).toBe(false);
    expect(maintenanceAllows('PUT', '/v1/configuration')).toBe(false);
    expect(maintenanceAllows('GET', '/v1/configuration')).toBe(false);
    expect(maintenanceAllows('GET', '/v1/users')).toBe(false);
    expect(maintenanceAllows('GET', '/v1/m/example/products')).toBe(false);
  });
});

describe('maintenance mode — off', () => {
  test('nothing changes: an anonymous protected read is 401 as before', async () => {
    delete process.env.MAINTENANCE_MODE;
    resetEnvCache();
    expect((await get('/v1/users')).status).toBe(401);
  });
});
