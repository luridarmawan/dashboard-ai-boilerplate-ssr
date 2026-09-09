import { and, type Db, eq, inArray, newId, schema } from '@core/db';
import type { ConfigFieldDef } from '@core/module-kit';
import { type CacheAdapter, DatabaseVersionCache } from './cache.ts';
import { configFields, configSections, type RegistryField } from './registry.ts';
import { type ConfigValue, parseValue, validateValue } from './validate.ts';

/**
 * The configuration store (PRD E-1…E-5). Rows: `scope` = tenant id or `global`. Reading a
 * tenant resolves tenant → global → field default (E-2). All rows are loaded at once and kept
 * behind the cache adapter — configuration is small and read on every request.
 */
export const GLOBAL = 'global';

type Rows = { scope: string; key: string; value: string | null }[];

export interface ResolvedEntry {
  readonly key: string;
  readonly value: ConfigValue;
  /** Where the value came from. */
  readonly source: 'tenant' | 'global' | 'default';
  readonly field: RegistryField;
}

export interface SaveEntry {
  readonly key: string;
  readonly value: unknown;
}

export interface SaveResult {
  readonly changed: { key: string; before: string | null; after: string | null }[];
  readonly errors: Record<string, string>;
}

export class SettingsStore {
  private readonly cache: CacheAdapter<Rows>;
  constructor(
    private readonly db: Db,
    cache?: CacheAdapter<Rows>,
  ) {
    this.cache = cache ?? new DatabaseVersionCache<Rows>(db, 'config');
  }

  private async rows(): Promise<Rows> {
    const cached = await this.cache.get();
    if (cached) return cached;
    const fresh = await this.db
      .select({
        scope: schema.configurations.scope,
        key: schema.configurations.key,
        value: schema.configurations.value,
      })
      .from(schema.configurations);
    await this.cache.set(fresh);
    return fresh;
  }

  /** Every registered field resolved for one tenant (or global when `clientId` is null). */
  async resolveAll(clientId: string | null): Promise<Map<string, ResolvedEntry>> {
    const rows = await this.rows();
    const byScope = (scope: string) =>
      new Map(rows.filter((r) => r.scope === scope).map((r) => [r.key, r.value]));
    const tenant = clientId ? byScope(clientId) : new Map<string, string | null>();
    const global = byScope(GLOBAL);
    const out = new Map<string, ResolvedEntry>();
    for (const [key, field] of configFields()) {
      if (tenant.has(key))
        out.set(key, { key, field, source: 'tenant', value: parseValue(field, tenant.get(key)) });
      else if (global.has(key))
        out.set(key, { key, field, source: 'global', value: parseValue(field, global.get(key)) });
      else out.set(key, { key, field, source: 'default', value: parseValue(field, null) });
    }
    return out;
  }

  /** One value, typed. */
  async get<T extends ConfigValue = ConfigValue>(clientId: string | null, key: string): Promise<T> {
    const all = await this.resolveAll(clientId);
    return (all.get(key)?.value ?? null) as T;
  }

  /**
   * Values safe for the browser (E-4): only `public` fields, and secrets never in the clear —
   * a secret is reported as `{ set: true|false }` and only through the admin view.
   */
  async publicValues(clientId: string | null): Promise<Record<string, ConfigValue>> {
    const all = await this.resolveAll(clientId);
    const out: Record<string, ConfigValue> = {};
    for (const e of all.values())
      if (e.field.public && e.field.type !== 'secret') out[e.key] = e.value;
    return out;
  }

  /** Admin view of one scope: sections with fields, values masked where secret. */
  async adminView(clientId: string | null) {
    const all = await this.resolveAll(clientId);
    return configSections().map((s) => ({
      section: s.section,
      module: s.module,
      title: s.title,
      note: s.note ?? null,
      order: s.order ?? 100,
      // Extension point 6: buttons the section offers beside "Save" (e.g. "test connection").
      // The page renders them generically; it never learns what a module's action does.
      actions: (s.actions ?? []).map((a) => ({
        key: a.key,
        label: a.label,
        endpoint: a.endpoint,
        permission: a.permission ?? null,
        note: a.note ?? null,
      })),
      fields: [...s.fields]
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        .map((f) => {
          const e = all.get(f.key);
          const value = e?.value ?? null;
          return {
            key: f.key,
            type: f.type,
            title: f.title,
            note: f.note ?? null,
            options: f.options ?? null,
            public: !!f.public,
            min: f.min ?? null,
            max: f.max ?? null,
            source: e?.source ?? 'default',
            // E-4: a secret is only ever "set" or "empty" outside the process.
            value: f.type === 'secret' ? null : value,
            secretSet: f.type === 'secret' ? value !== null && value !== '' : null,
          };
        }),
    }));
  }

  /**
   * Save entries for one scope. Validates every value (E-3); unknown keys are rejected. Empty
   * string clears the override (the scope falls back). Always invalidates the cache (E-5).
   */
  async save(
    clientId: string | null,
    entries: readonly SaveEntry[],
    opts: {
      actorId?: string | null;
      routes?: readonly string[];
      allowedThemes?: readonly string[];
    } = {},
  ): Promise<SaveResult> {
    const fields = configFields();
    const errors: Record<string, string> = {};
    const plan: {
      key: string;
      field: ConfigFieldDef & { section: string };
      stored: string | null;
    }[] = [];
    for (const e of entries) {
      const field = fields.get(e.key);
      if (!field) {
        errors[e.key] = 'kunci tidak dikenal';
        continue;
      }
      // Secrets: an empty submit means "keep"; the literal `__clear__` clears.
      if (field.type === 'secret' && (e.value === '' || e.value === undefined)) continue;
      const v = validateValue(field, e.value === '__clear__' ? null : e.value, {
        routes: opts.routes,
      });
      if (!v.ok) {
        errors[e.key] = v.message;
        continue;
      }
      if (
        e.key === 'app.default_theme' &&
        v.stored &&
        opts.allowedThemes?.length &&
        !opts.allowedThemes.includes(v.stored)
      ) {
        errors[e.key] = 'tema baku harus termasuk tema yang boleh dipilih';
        continue;
      }
      plan.push({ key: e.key, field, stored: v.stored });
    }
    if (Object.keys(errors).length) return { changed: [], errors };
    if (!plan.length) return { changed: [], errors: {} };

    const scope = clientId ?? GLOBAL;
    const existing = await this.db
      .select()
      .from(schema.configurations)
      .where(
        and(
          eq(schema.configurations.scope, scope),
          inArray(
            schema.configurations.key,
            plan.map((p) => p.key),
          ),
        ),
      );
    const byKey = new Map(existing.map((r) => [r.key, r]));
    const changed: SaveResult['changed'] = [];
    for (const p of plan) {
      const row = byKey.get(p.key);
      const before = row?.value ?? null;
      if (p.stored === null) {
        if (row) {
          await this.db.delete(schema.configurations).where(eq(schema.configurations.id, row.id));
          changed.push({ key: p.key, before, after: null });
        }
        continue;
      }
      if (row) {
        if (before !== p.stored) {
          await this.db
            .update(schema.configurations)
            .set({ value: p.stored, updated_by: opts.actorId ?? null })
            .where(eq(schema.configurations.id, row.id));
          changed.push({ key: p.key, before, after: p.stored });
        }
      } else {
        await this.db.insert(schema.configurations).values({
          id: newId(),
          scope,
          client_id: clientId,
          section: p.field.section,
          sub: null,
          key: p.key,
          value: p.stored,
          type: p.field.type,
          title: p.field.title.id,
          note: p.field.note?.id ?? null,
          order: p.field.order ?? 100,
          public: !!p.field.public,
          updated_by: opts.actorId ?? null,
        });
        changed.push({ key: p.key, before: null, after: p.stored });
      }
    }
    if (changed.length) await this.cache.invalidate();
    return { changed, errors: {} };
  }

  /** For tests / after external writes. */
  async invalidate(): Promise<void> {
    await this.cache.invalidate();
  }
}

/** Mask a change list for the audit log: secrets never leave as values (E-4, M-7). */
export function maskChanges(changed: SaveResult['changed']): SaveResult['changed'] {
  const fields = configFields();
  return changed.map((c) =>
    fields.get(c.key)?.type === 'secret'
      ? {
          key: c.key,
          before: c.before === null ? null : '***',
          after: c.after === null ? null : '***',
        }
      : c,
  );
}
