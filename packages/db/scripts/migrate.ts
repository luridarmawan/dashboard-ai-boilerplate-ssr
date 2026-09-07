#!/usr/bin/env bun
/**
 * `bun db:migrate` — apply versioned migrations for the active dialect (O-1, Q-4).
 * The package script runs codegen first, so the embedded SQL is always current. The compiled
 * api binary reaches the same `runMigrations()` through `api migrate` (Q-2).
 */
import { describeMigrateResult, runMigrations } from '../src/migrate.ts';

try {
  console.log(describeMigrateResult(await runMigrations()));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
