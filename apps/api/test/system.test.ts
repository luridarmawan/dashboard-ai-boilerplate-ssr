import { describe, expect, test } from 'bun:test';
import { app } from '../src/app.ts';

// Exercise the assembled app in-process — no port, no network (P-8 unit level).
const call = (path: string, init?: RequestInit) =>
  app.handle(new Request(`http://api.test${path}`, init));

describe('envelope & request id (N-4, M-1)', () => {
  test('/v1/health → success envelope + x-request-id minted', async () => {
    const res = await call('/v1/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { status: 'ok', uptime: expect.any(Number) } });
    const rid = res.headers.get('x-request-id');
    expect(rid).toMatch(/^[0-9a-f-]{36}$/);
    expect(rid?.[14]).toBe('7'); // UUIDv7 from the single generator (O-6)
  });

  test('incoming x-request-id is honoured, not replaced', async () => {
    const res = await call('/v1/health', { headers: { 'x-request-id': 'web-abc-123' } });
    expect(res.headers.get('x-request-id')).toBe('web-abc-123');
  });

  test('unknown route → 404 failure envelope with the request id', async () => {
    const res = await call('/v1/nope', { headers: { 'x-request-id': 'rid-404' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'not_found', message: expect.any(String) },
      requestId: 'rid-404',
    });
  });
});

describe('OpenAPI at runtime (N-2)', () => {
  test('/openapi.json is 3.x and lists the system routes with envelope schemas', async () => {
    const res = await call('/openapi.json');
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/v1/health', '/v1/ready', '/v1/version']),
    );
    expect(spec.paths['/v1/health']?.get?.responses['200']).toBeDefined();
  });

  test('/docs serves the UI', async () => {
    const res = await call('/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });
});

describe('/v1/version (M-5)', () => {
  test('reports build identity and the installed modules from the registry', async () => {
    const res = await call('/v1/version');
    const body = (await res.json()) as {
      success: true;
      data: { name: string; version: string; dialect: string; modules: { name: string }[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('dashboard-ai-boilerplate');
    expect(body.data.modules.map((m) => m.name)).toContain('Dummy');
  });
});
