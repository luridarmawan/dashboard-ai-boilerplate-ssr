import { and, type Db, eq, newId, schema } from '@core/db';
import { type CacheAdapter, DatabaseVersionCache } from './cache.ts';
import { GLOBAL } from './store.ts';

/**
 * Module enablement per tenant (PRD G-8). Absence of a row = enabled. A tenant row overrides
 * the global row. Cached like configuration (E-5) so N instances agree without restart.
 */
type Rows = { scope: string; module: string; enabled: boolean }[];

export class ModuleStateStore {
  private readonly cache: CacheAdapter<Rows>;
  constructor(
    private readonly db: Db,
    private readonly installed: readonly string[],
    cache?: CacheAdapter<Rows>,
  ) {
    this.cache = cache ?? new DatabaseVersionCache<Rows>(db, 'modules');
  }

  private async rows(): Promise<Rows> {
    const cached = await this.cache.get();
    if (cached) return cached;
    const fresh = await this.db
      .select({
        scope: schema.modules.scope,
        module: schema.modules.module,
        enabled: schema.modules.enabled,
      })
      .from(schema.modules);
    await this.cache.set(fresh);
    return fresh;
  }

  /** Enabled module names for a tenant (global when null). Only installed modules are listed. */
  async enabledFor(clientId: string | null): Promise<Set<string>> {
    const rows = await this.rows();
    const out = new Set<string>();
    for (const name of this.installed) {
      const tenant = clientId
        ? rows.find((r) => r.scope === clientId && r.module === name)
        : undefined;
      const global = rows.find((r) => r.scope === GLOBAL && r.module === name);
      const enabled = tenant ? tenant.enabled : global ? global.enabled : true;
      if (enabled) out.add(name);
    }
    return out;
  }

  async isEnabled(clientId: string | null, module: string): Promise<boolean> {
    return (await this.enabledFor(clientId)).has(module);
  }

  /** Admin listing: each installed module with its global and tenant state. */
  async listFor(clientId: string | null) {
    const rows = await this.rows();
    return this.installed.map((name) => {
      const global = rows.find((r) => r.scope === GLOBAL && r.module === name);
      const tenant = clientId
        ? rows.find((r) => r.scope === clientId && r.module === name)
        : undefined;
      return {
        module: name,
        globalEnabled: global ? global.enabled : true,
        tenantEnabled: tenant ? tenant.enabled : null,
        effective: tenant ? tenant.enabled : global ? global.enabled : true,
      };
    });
  }

  /** Set the state for one scope (`clientId` null = global). Invalidates every instance. */
  async setEnabled(
    clientId: string | null,
    module: string,
    enabled: boolean,
    actorId: string | null = null,
  ): Promise<void> {
    if (!this.installed.includes(module)) throw new Error(`modul "${module}" tidak terpasang`);
    const scope = clientId ?? GLOBAL;
    const [row] = await this.db
      .select({ id: schema.modules.id })
      .from(schema.modules)
      .where(and(eq(schema.modules.scope, scope), eq(schema.modules.module, module)))
      .limit(1);
    if (row) {
      await this.db
        .update(schema.modules)
        .set({ enabled, updated_by: actorId })
        .where(eq(schema.modules.id, row.id));
    } else {
      await this.db
        .insert(schema.modules)
        .values({ id: newId(), scope, client_id: clientId, module, enabled, updated_by: actorId });
    }
    await this.cache.invalidate();
  }

  /** Remove the tenant override so the global state applies again. */
  async clearOverride(clientId: string, module: string): Promise<void> {
    await this.db
      .delete(schema.modules)
      .where(and(eq(schema.modules.scope, clientId), eq(schema.modules.module, module)));
    await this.cache.invalidate();
  }
}
