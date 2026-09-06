import { defineConfig } from 'drizzle-kit';

// MySQL/MariaDB migrations. Both share the schema (mysql-core) but are tested separately in CI (P-9).
export default defineConfig({
  dialect: 'mysql',
  schema: './src/generated/schema.mysql.ts',
  out: './migrations/mysql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'mysql://app:app@127.0.0.1:33306/app' },
  strict: true,
  verbose: true,
});
