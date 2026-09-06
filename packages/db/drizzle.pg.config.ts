import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/generated/schema.pg.ts',
  out: './migrations/pg',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://app:app@127.0.0.1:35432/app' },
  strict: true,
  verbose: true,
});
