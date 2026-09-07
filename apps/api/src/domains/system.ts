import { env } from '@core/config';
import { OkSchema, ok } from '@core/contracts';
import { activeDialect, schema, unsafeAcrossTenants } from '@core/db';
import { modules } from '@core/module-kit/registry';
import { Elysia, t } from 'elysia';
// Static import: bundled into the compiled binary (Q-2) — a runtime file read would look for
// /package.json next to the executable and crash.
import rootPkg from '../../../../package.json' with { type: 'json' };
import { instanceId } from '../instance.ts';

/**
 * System endpoints (PRD M-4, M-5).
 *
 *   /health   liveness — the process is up; never touches a dependency
 *   /ready    readiness — the database answers (Redis only when a redis driver is active)
 *   /version  build identity + installed modules, for support and for the module admin UI
 */

const build = {
  name: rootPkg.name,
  version: rootPkg.version,
  commit: process.env.APP_COMMIT ?? 'dev',
  builtAt: process.env.APP_BUILT_AT ?? null,
};

const ModuleInfo = t.Object({
  name: t.String(),
  ns: t.String(),
  version: t.String(),
  source: t.String(),
});

export const system = new Elysia({ name: 'system', tags: ['system'] })
  .get(
    '/health',
    () => ok({ status: 'ok' as const, uptime: Math.round(process.uptime()), instance: instanceId }),
    {
      response: OkSchema(
        t.Object({ status: t.Literal('ok'), uptime: t.Integer(), instance: t.String() }),
      ),
      detail: { summary: 'Liveness — the process is up' },
    },
  )

  .get(
    '/ready',
    async ({ set }) => {
      const e = env();
      const checks: Record<string, { ok: boolean; ms: number; error?: string }> = {};

      const t0 = performance.now();
      try {
        // Readiness probe on a global table — no tenant in scope here, by design.
        await unsafeAcrossTenants().select({ id: schema.clients.id }).from(schema.clients).limit(1);
        checks.database = { ok: true, ms: Math.round(performance.now() - t0) };
      } catch (err) {
        checks.database = {
          ok: false,
          ms: Math.round(performance.now() - t0),
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Redis is optional (Decision M): only a dependency when a driver actually uses it.
      const usesRedis = [e.SESSION_DRIVER, e.CACHE_DRIVER, e.RATELIMIT_DRIVER].includes('redis');
      if (usesRedis) {
        const t1 = performance.now();
        try {
          const Client = (
            Bun as unknown as {
              RedisClient: new (
                url: string,
              ) => { send(cmd: string, args: string[]): Promise<unknown>; close(): void };
            }
          ).RedisClient;
          const client = new Client(e.REDIS_URL ?? '');
          const pong = await client.send('PING', []);
          client.close();
          checks.redis = {
            ok: String(pong).toUpperCase() === 'PONG',
            ms: Math.round(performance.now() - t1),
          };
        } catch (err) {
          checks.redis = {
            ok: false,
            ms: Math.round(performance.now() - t1),
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      const ready = Object.values(checks).every((c) => c.ok);
      if (!ready) set.status = 503;
      return ok({ ready, dialect: activeDialect, checks });
    },
    {
      response: {
        200: OkSchema(
          t.Object({
            ready: t.Boolean(),
            dialect: t.String(),
            checks: t.Record(t.String(), t.Any()),
          }),
        ),
        503: OkSchema(
          t.Object({
            ready: t.Boolean(),
            dialect: t.String(),
            checks: t.Record(t.String(), t.Any()),
          }),
        ),
      },
      detail: { summary: 'Readiness — database (and Redis when enabled) answer' },
    },
  )

  .get('/version', () => ok({ ...build, dialect: activeDialect, modules: [...modules] }), {
    response: OkSchema(
      t.Object({
        name: t.String(),
        version: t.String(),
        commit: t.String(),
        builtAt: t.Nullable(t.String()),
        dialect: t.String(),
        modules: t.Array(ModuleInfo),
      }),
    ),
    detail: { summary: 'Build identity and installed modules' },
  });
