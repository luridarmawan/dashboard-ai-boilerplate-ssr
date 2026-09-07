#!/usr/bin/env bun
/**
 * `bun db:seed` (root) → `bun run --cwd packages/auth seed` — idempotent seed (PRD O-3).
 * The compiled api binary reaches the same `runSeedAll()` through `api seed` (Q-2).
 */
import { runSeedAll } from '../src/seed-all.ts';

await runSeedAll();
