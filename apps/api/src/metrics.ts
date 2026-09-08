import { poolStats } from '@core/db';
import { CONTENT_TYPE, registerProcessMetrics, registry, routeLabel } from '@core/metrics';
import { Elysia } from 'elysia';
import { instanceId } from './instance.ts';

/**
 * Prometheus metrics (PRD M-6): request rate, latency histogram (p50/p95/p99 are computed by the
 * scraper from the buckets), error rate by status class, in-flight requests, DB pool, scheduler
 * runs, hook runs, process gauges — exposed at `GET /metrics` in the text format.
 *
 * The endpoint sits at the API root, NOT under /v1, so Caddy never proxies it to the internet;
 * Prometheus scrapes `api:3001/metrics` inside the Docker network (or 127.0.0.1 under systemd).
 * `METRICS_TOKEN` adds a bearer check for setups where the port is reachable more widely.
 *
 * Modules register their own instruments through this same registry:
 *   import { metrics } from '@app/api/metrics';
 *   const hits = metrics.counter('<ns>_things_total', 'Things done.', ['kind']);
 * Names are Prometheus names (snake_case, unit suffix); label values must be bounded — never a
 * user id, tenant id or free text.
 */
export { CONTENT_TYPE, registry as metrics } from '@core/metrics';

export const httpRequestsTotal = registry.counter(
  'http_requests_total',
  'HTTP requests handled, by method, matched route and status.',
  ['method', 'route', 'status'],
);
export const httpRequestDuration = registry.histogram(
  'http_request_duration_seconds',
  'HTTP request latency in seconds, by method and matched route.',
  ['method', 'route'],
);
/** In-flight requests come from Bun's server itself (`pendingRequests`) — exact, no hook pairing. */
let serverRef: (() => { pendingRequests: number } | null | undefined) | null = null;
export function bindServer(ref: () => { pendingRequests: number } | null | undefined): void {
  serverRef = ref;
}
registry
  .gauge('http_requests_in_flight', 'HTTP requests currently being handled (0 when not listening).')
  .collect((g) => g.set(serverRef?.()?.pendingRequests ?? 0));
export const httpErrorsTotal = registry.counter(
  'http_request_errors_total',
  'HTTP responses with status 5xx (server errors) or 4xx (client errors), by class.',
  ['class'],
);
export const jobRunsTotal = registry.counter(
  'scheduler_job_runs_total',
  'Scheduled job runs on this instance, by job and status.',
  ['job', 'status'],
);
export const jobDuration = registry.histogram(
  'scheduler_job_duration_seconds',
  'Scheduled job run duration in seconds.',
  ['job'],
  [0.05, 0.25, 1, 5, 15, 60, 300, 900],
);
export const hookRunsTotal = registry.counter(
  'event_hook_runs_total',
  'Module hook invocations, by event, module and outcome.',
  ['event', 'module', 'status'],
);

let infoRegistered = false;
/** `app_info` and the DB pool gauges; called once by the app assembly (idempotent). */
export function registerAppMetrics(info: { version: string; commit: string; dialect: string }) {
  if (infoRegistered) return;
  infoRegistered = true;
  registerProcessMetrics(registry);
  registry
    .gauge('app_info', 'Build identity; always 1.', ['version', 'commit', 'dialect', 'instance'])
    .set({ ...info, instance: instanceId }, 1);
  const pool = registry.gauge(
    'db_pool_connections',
    'Database pool connections by state (open, idle, queued waiters); absent when the driver hides them.',
    ['state'],
  );
  const max = registry.gauge('db_pool_max_connections', 'Configured database pool size.');
  max.collect((g) => {
    const s = poolStats();
    if (s) g.set(s.max);
  });
  pool.collect((g) => {
    const s = poolStats();
    if (!s) return;
    if (s.open !== null) g.set({ state: 'open' }, s.open);
    if (s.idle !== null) g.set({ state: 'idle' }, s.idle);
    if (s.queued !== null) g.set({ state: 'queued' }, s.queued);
  });
}

/** Record one finished request (called from the request-context plugin). */
export function observeRequest(
  method: string,
  route: string | undefined,
  path: string,
  status: number,
  ms: number,
): void {
  const r = routeLabel(route, path);
  httpRequestsTotal.inc({ method, route: r, status });
  httpRequestDuration.observeMs({ method, route: r }, ms);
  if (status >= 500) httpErrorsTotal.inc({ class: '5xx' });
  else if (status >= 400) httpErrorsTotal.inc({ class: '4xx' });
}

/**
 * `GET /metrics`. Read from process.env at request time (like `instanceId`) so importing the app
 * never triggers env validation and tests can toggle the token.
 */
export const metricsDomain = new Elysia({ name: 'metrics' }).get(
  '/metrics',
  ({ request, set }) => {
    if (process.env.METRICS_ENABLED === 'false') {
      set.status = 404;
      return 'metrics disabled';
    }
    const token = process.env.METRICS_TOKEN?.trim();
    if (token) {
      const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      if (given.length !== token.length || !timingSafeEqual(given, token)) {
        set.status = 401;
        set.headers['www-authenticate'] = 'Bearer realm="metrics"';
        return 'unauthorized';
      }
    }
    set.headers['content-type'] = CONTENT_TYPE;
    set.headers['cache-control'] = 'no-store';
    return registry.expose();
  },
  { detail: { hide: true } },
);

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
