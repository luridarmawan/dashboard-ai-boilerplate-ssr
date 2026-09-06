import { readFileSync } from 'node:fs';
import { env } from '@core/config';
import { OkSchema, ok } from '@core/contracts';
import { activeDialect, getDb, schema } from '@core/db';
import { modules } from '@core/module-kit/registry';
import { Elysia, t } from 'elysia';
import { instanceId } from '../instance.ts';

/**
 * System endpoints (PRD M-4, M-5).
 *
 *   /health   liveness — the process is up; never touches a dependency
 *   /ready    readiness — the database answers (Redis only when a redis driver is active)
 *   /version  build identity + installed modules, for support and for the module admin UI
 */

const rootPkg = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
) as { name: string; version: string };

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
        await getDb().select({ id: schema.clients.id }).from(schema.clients).limit(1);
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
      if (usesRedis)
        checks.redis = { ok: false, ms: 0, error: 'redis adapter belum diimplementasikan' };

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
