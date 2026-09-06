import { OkSchema, ok } from '@core/contracts';
import { count, schema, unsafeAcrossTenants } from '@core/db';
import { defineApiRoutes } from '@core/module-kit';
import { Elysia, t } from 'elysia';

/**
 * Module API (extension point 2). Paths are relative — sync mounts this under /v1/m/dummy.
 * Schemas on every route so they appear in /openapi.json like core routes (N-1, N-2).
 */
export default defineApiRoutes(
  'Dummy',
  new Elysia({ name: 'module:dummy', tags: ['module:dummy'] })
    .get('/ping', () => ok({ module: 'dummy' as const, at: new Date().toISOString() }), {
      response: OkSchema(t.Object({ module: t.Literal('dummy'), at: t.String() })),
      detail: { summary: 'Proves the module is mounted under its namespace' },
    })
    // Reaches the module's own table through the shared db instance (P-6). Tenant scoping
    // arrives with the data-layer guard in M1 (B-3); until then this stays a count.
    .get(
      '/notes/count',
      async () => {
        const [row] = await unsafeAcrossTenants().select({ n: count() }).from(schema.dummyNotes);
        return ok({ count: Number(row?.n ?? 0) });
      },
      {
        response: OkSchema(t.Object({ count: t.Integer() })),
        detail: { summary: 'Number of rows in dummy_notes' },
      },
    ),
);
