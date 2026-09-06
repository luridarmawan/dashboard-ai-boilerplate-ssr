import { col, defineTable } from '../src/descriptor.ts';

/**
 * Windowed counters for the default `RATELIMIT_DRIVER=database` (Decision M). Global on purpose:
 * a nullable `client_id` in a unique index would not be unique (NULLs are distinct on MySQL and
 * PostgreSQL alike). Tenant scoping, when wanted, is part of the key: `login:ip:1.2.3.4`,
 * `tenant:<id>:api:<user>`.
 */
export const rateLimits = defineTable({
  name: 'rate_limits',
  tenant: false,
  softDelete: false,
  columns: {
    key: col.identifier(191),
    window_start: col.datetime(),
    count: col.int().default(0),
  },
  indexes: [{ columns: ['key'], unique: true }, { columns: ['window_start'] }],
});
