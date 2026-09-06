import type { TableDef } from '../src/descriptor.ts';
import { auditLog } from './audit_log.def.ts';
import { clients } from './clients.def.ts';
import { schedulerJobs } from './scheduler_jobs.def.ts';
import { schedulerRuns } from './scheduler_runs.def.ts';

/**
 * Core table list. Modules do NOT add to this — module tables enter through
 * `modules/<Name>/db/tables.ts` and are assembled by `modules:sync` (G-2, G-6).
 * Order is irrelevant; codegen sorts by name.
 */
export const tables: readonly TableDef[] = [clients, auditLog, schedulerJobs, schedulerRuns];
