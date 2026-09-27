import { logger } from '@core/logger';
import { modules } from '@core/module-kit/registry';
import { Elysia } from 'elysia';
import { moduleState } from '../services.ts';
import { tenantContext } from './tenancy.ts';

interface OpenApiDoc {
  paths?: Record<string, unknown>;
  tags?: { name: string }[];
}

/**
 * Hides the routes of disabled modules from `/openapi.json` (and so from the `/docs` UI), using
 * the same tenant the module gate uses: session / X-Client-ID, anonymous → global state.
 *
 * Must be `.use()`d BEFORE `openapi()`: a global hook only reaches routes registered after it.
 * The spec object is cached by the OpenAPI plugin, so it is copied, never mutated.
 */
export const openapiModuleFilter = new Elysia({ name: 'openapi-module-filter' })
  .use(tenantContext)
  .onAfterHandle({ as: 'global' }, async ({ path, response, tenantState }) => {
    if (path !== '/openapi.json' || !response || typeof response !== 'object') return;
    const doc = response as OpenApiDoc;
    let enabled: Set<string>;
    try {
      enabled = await moduleState.enabledFor(tenantState?.clientId ?? null);
    } catch (err) {
      // Same stance as the module gate: state unreadable → document everything.
      logger.warn('openapi-module-filter: state unreadable, showing all modules', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const hidden = modules.filter((m) => !enabled.has(m.name)).map((m) => m.ns);
    if (hidden.length === 0) return;
    const isHidden = (p: string) =>
      hidden.some((ns) => p === `/v1/m/${ns}` || p.startsWith(`/v1/m/${ns}/`));
    return {
      ...doc,
      paths: Object.fromEntries(Object.entries(doc.paths ?? {}).filter(([p]) => !isHidden(p))),
      ...(doc.tags && {
        tags: doc.tags.filter((t) => !hidden.some((ns) => t.name === `module:${ns}`)),
      }),
    };
  });
