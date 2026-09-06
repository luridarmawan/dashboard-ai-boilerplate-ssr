import { fail } from '@core/contracts';
import { newId } from '@core/db';
import { logger } from '@core/logger';
import { modules } from '@core/module-kit/registry';
import { Elysia } from 'elysia';
import { moduleState } from '../services.ts';
import { tenantContext } from './tenancy.ts';

/**
 * G-8: a module disabled for the active tenant refuses its routes. Applies to `/v1/m/<ns>/*`;
 * the tenant comes from the session / X-Client-ID (anonymous → global state).
 */
const byNs = new Map<string, string>(modules.map((m) => [m.ns, m.name]));

export const moduleGate = new Elysia({ name: 'module-gate' })
  .use(tenantContext)
  .onBeforeHandle({ as: 'global' }, async ({ path, tenantState, set, request }) => {
    const m = /^\/v1\/m\/([a-z][a-z0-9]*)(\/|$)/.exec(path);
    if (!m) return;
    const name = byNs.get(m[1] ?? '');
    if (!name) return;
    const clientId = tenantState?.clientId ?? null;
    let enabled = true;
    try {
      enabled = await moduleState.isEnabled(clientId, name);
    } catch (err) {
      // Module state is an admin preference, not a security boundary: when the store cannot be
      // read (e.g. unit tests without a database) the module stays reachable, and we say so.
      logger.warn('module-gate: state unreadable, allowing', {
        module: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (enabled) return;
    set.status = 403;
    const rid = String(
      set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId(),
    );
    return fail('module_disabled', `Modul ${name} nonaktif untuk tenant ini`, rid, {
      module: name,
    });
  });
