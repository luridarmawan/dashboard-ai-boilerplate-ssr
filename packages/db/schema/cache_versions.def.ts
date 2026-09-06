import { col, defineTable } from '../src/descriptor.ts';

/**
 * Version counters for the `database` cache adapter (PRD E-5, Decision M). A process keeps a
 * copy of, say, the configuration in memory and uses it ONLY while `version` still matches;
 * every save bumps the counter, so N instances converge on the next request without Redis.
 */
export const cacheVersions = defineTable({
  name: 'cache_versions',
  tenant: false,
  softDelete: false,
  columns: {
    name: col.identifier(64),
    version: col.int().default(1),
  },
  indexes: [{ columns: ['name'], unique: true }],
});
