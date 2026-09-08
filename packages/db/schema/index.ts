import type { TableDef } from '../src/descriptor.ts';
import { apiTokens } from './api_tokens.def.ts';
import { auditLog } from './audit_log.def.ts';
import { cacheVersions } from './cache_versions.def.ts';
import { clientUserMaps } from './client_user_maps.def.ts';
import { clients } from './clients.def.ts';
import { configurations } from './configurations.def.ts';
import { emailVerificationTokens } from './email_verification_tokens.def.ts';
import { files } from './files.def.ts';
import { groupPermissions } from './group_permissions.def.ts';
import { groupUserMaps } from './group_user_maps.def.ts';
import { groups } from './groups.def.ts';
import { modules } from './modules.def.ts';
import { notifications } from './notifications.def.ts';
import { outboxEmail } from './outbox_email.def.ts';
import { passwordResetTokens } from './password_reset_tokens.def.ts';
import { rateLimits } from './rate_limits.def.ts';
import { schedulerJobs } from './scheduler_jobs.def.ts';
import { schedulerRuns } from './scheduler_runs.def.ts';
import { sessions } from './sessions.def.ts';
import { themes } from './themes.def.ts';
import { users } from './users.def.ts';
import { webhookDeliveries, webhooks } from './webhooks.def.ts';

/**
 * Core table list. Modules do NOT add to this — module tables enter through
 * `modules/<Name>/db/tables.ts` and are assembled by `modules:sync` (G-2, G-6).
 * Order is irrelevant; codegen sorts by name and resolves references lazily.
 */
export const tables: readonly TableDef[] = [
  clients,
  users,
  sessions,
  apiTokens,
  clientUserMaps,
  groups,
  groupPermissions,
  groupUserMaps,
  passwordResetTokens,
  emailVerificationTokens,
  rateLimits,
  auditLog,
  schedulerJobs,
  schedulerRuns,
  configurations,
  cacheVersions,
  modules,
  themes,
  notifications,
  files,
  webhooks,
  webhookDeliveries,
  outboxEmail,
];
