import { describe, expect, test } from 'bun:test';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  registerProcessMetrics,
  routeLabel,
} from '../src/index.ts';

describe('@core/metrics (M-6)', () => {
  test('counter: labelled increments render in the exposition format; negatives refused', () => {
    const c = new Counter('http_requests_total', 'Requests.', ['method', 'status']);
    c.inc({ method: 'GET', status: 200 });
    c.inc({ method: 'GET', status: 200 }, 2);
    c.inc({ method: 'POST', status: 500 });
    expect(c.get({ method: 'GET', status: 200 })).toBe(3);
    expect(c.render()).toBe(
      [
        '# HELP http_requests_total Requests.',
        '# TYPE http_requests_total counter',
        'http_requests_total{method="GET",status="200"} 3',
        'http_requests_total{method="POST",status="500"} 1',
      ].join('\n'),
    );
    expect(() => c.inc({}, -1)).toThrow();
    expect(() => new Counter('bad-name', 'x')).toThrow();
  });

  test('gauge: set/inc/dec, collectors run at render time, label values are escaped', () => {
    const g = new Gauge('db_pool_connections', 'Pool.', ['state']);
    g.set({ state: 'open' }, 4);
    g.inc({ state: 'open' });
    g.dec({ state: 'open' }, 2);
    expect(g.get({ state: 'open' })).toBe(3);
    const dyn = new Gauge('dyn', 'Dynamic.').collect((x) => x.set(42));
    expect(dyn.render()).toContain('dyn 42');
    const esc = new Gauge('esc', 'E.', ['v']);
    esc.set({ v: 'a"b\\c\nd' }, 1);
    expect(esc.render()).toContain('esc{v="a\\"b\\\\c\\nd"} 1');
  });

  test('histogram: cumulative buckets, +Inf, sum and count; ms helper converts to seconds', () => {
    const h = new Histogram('req_seconds', 'Latency.', ['route'], [0.1, 0.5, 1]);
    h.observe({ route: '/a' }, 0.05);
    h.observe({ route: '/a' }, 0.3);
    h.observe({ route: '/a' }, 2);
    h.observeMs({ route: '/a' }, 700); // 0.7 s
    expect(h.get({ route: '/a' })).toEqual({ count: 4, sum: 3.05 });
    const out = h.render();
    expect(out).toContain('req_seconds_bucket{route="/a",le="0.1"} 1');
    expect(out).toContain('req_seconds_bucket{route="/a",le="0.5"} 2');
    expect(out).toContain('req_seconds_bucket{route="/a",le="1"} 3');
    expect(out).toContain('req_seconds_bucket{route="/a",le="+Inf"} 4');
    expect(out).toContain('req_seconds_sum{route="/a"} 3.05');
    expect(out).toContain('req_seconds_count{route="/a"} 4');
    expect(() => new Histogram('h', 'x', ['le'])).toThrow();
  });

  test('registry: same name returns the same instrument, type clash throws, expose sorts families', () => {
    const reg = new Registry();
    const a = reg.counter('zeta_total', 'Z.');
    const b = reg.counter('zeta_total', 'Z again.');
    expect(a).toBe(b);
    reg.gauge('alpha', 'A.').set(1);
    expect(() => reg.gauge('zeta_total', 'clash')).toThrow();
    const body = reg.expose();
    expect(body.indexOf('# TYPE alpha gauge')).toBeLessThan(
      body.indexOf('# TYPE zeta_total counter'),
    );
    expect(body.endsWith('\n')).toBe(true);
    registerProcessMetrics(reg);
    registerProcessMetrics(reg); // idempotent
    expect(reg.expose()).toMatch(/process_resident_memory_bytes \d+/);
    expect(reg.expose()).toMatch(/process_uptime_seconds [\d.]+/);
  });

  test('routeLabel: matched pattern wins; unmatched paths have ids collapsed', () => {
    expect(routeLabel('/v1/users/:id', '/v1/users/0192…')).toBe('/v1/users/:id');
    expect(routeLabel(undefined, '/v1/files/0192a3b4-1234-7abc-8def-0123456789ab/content')).toBe(
      '/v1/files/:id/content',
    );
    expect(routeLabel(undefined, '/x/123/y')).toBe('/x/:n/y');
  });
});
