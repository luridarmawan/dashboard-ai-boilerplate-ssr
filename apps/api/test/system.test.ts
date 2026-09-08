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
    expect(body).toEqual({
      success: true,
      data: { status: 'ok', uptime: expect.any(Number), instance: expect.any(String) },
    });
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

describe('/metrics (M-6)', () => {
  test('exposes Prometheus text: request counters and latency buckets for the routes just hit, app_info, process gauges', async () => {
    await call('/v1/health');
    await call('/v1/nope-404');
    // Metrics are recorded in onAfterResponse, which runs after the response has been handed back.
    await Bun.sleep(30);
    const res = await call('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain; version=0.0.4');
    const body = await res.text();
    expect(body).toContain('# TYPE http_requests_total counter');
    expect(body).toMatch(
      /http_requests_total\{method="GET",route="\/v1\/health",status="200"\} \d+/,
    );
    expect(body).toMatch(/http_request_errors_total\{class="4xx"\} \d+/);
    expect(body).toMatch(
      /http_request_duration_seconds_bucket\{method="GET",route="\/v1\/health",le="\+Inf"\} \d+/,
    );
    expect(body).toMatch(
      /app_info\{version="[^"]+",commit="[^"]+",dialect="[^"]+",instance="[^"]+"\} 1/,
    );
    expect(body).toMatch(/process_resident_memory_bytes \d+/);
    expect(body).toContain('# TYPE scheduler_job_runs_total counter');
    // Not listening in tests: Bun's pendingRequests is unavailable, so the gauge reads 0.
    expect(body).toContain('http_requests_in_flight 0\n');
    // No raw ids in route labels: an unmatched path with a uuid collapses to :id.
    await call('/v1/files/0192a3b4-1234-7abc-8def-0123456789ab/nowhere');
    await Bun.sleep(30);
    expect(await (await call('/metrics')).text()).not.toContain(
      '0192a3b4-1234-7abc-8def-0123456789ab',
    );
    // The endpoint itself is not documented in OpenAPI.
    const spec = (await (await call('/openapi.json')).json()) as { paths: Record<string, unknown> };
    expect(spec.paths['/metrics']).toBeUndefined();
  });

  test('METRICS_TOKEN gates the scrape with a bearer token; METRICS_ENABLED=false hides it', async () => {
    process.env.METRICS_TOKEN = 'a-scrape-token-for-tests';
    try {
      expect((await call('/metrics')).status).toBe(401);
      expect((await call('/metrics', { headers: { authorization: 'Bearer wrong' } })).status).toBe(
        401,
      );
      const ok = await call('/metrics', {
        headers: { authorization: 'Bearer a-scrape-token-for-tests' },
      });
      expect(ok.status).toBe(200);
    } finally {
      delete process.env.METRICS_TOKEN;
    }
    process.env.METRICS_ENABLED = 'false';
    try {
      expect((await call('/metrics')).status).toBe(404);
    } finally {
      delete process.env.METRICS_ENABLED;
    }
  });
});
