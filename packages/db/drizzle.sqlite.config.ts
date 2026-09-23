import { defineConfig } from 'drizzle-kit';

// SQLite migrations (tier 2, §4.3): one file, no server. `generate` never opens the database,
// so the credential below only matters if drizzle-kit is pointed at a live file by hand.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/generated/schema.sqlite.ts',
  out: './migrations/sqlite',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./data/app.db' },
  strict: true,
  verbose: true,
});
