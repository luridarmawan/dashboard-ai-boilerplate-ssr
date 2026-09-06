import { col, defineTable } from '../src/descriptor.ts';

/**
 * Audit log (M-2): actor, tenant, IP, before/after values for sensitive actions.
 * Append-only — no soft delete; retention is governed by policy (M-3), not `deleted_at`.
 * Tenant-scoped with `client_id NOT NULL`; every index starts with `client_id` (B-0).
 */
export const auditLog = defineTable({
  name: 'audit_log',
  tenant: true,
  softDelete: false,
  columns: {
    /** NULL = system action (scheduled job, migration). */
    actor_id: col.uuid().nullable(),
    /** `resource.action`, e.g. `user.edit`, `config.save` — same shape as permissions (C-1). */
    action: col.identifier(64),
    resource: col.identifier(64),
    resource_id: col.identifier(64).nullable(),
    /** IPv6 fits in 45 characters. */
    ip: col.identifier(45).nullable(),
    /** Flows from web → API → log (M-1). */
    request_id: col.identifier(64).nullable(),
    before: col.json().nullable(),
    after: col.json().nullable(),
    note: col.text().nullable(),
  },
  indexes: [
    { columns: ['client_id', 'created_at'] },
    { columns: ['client_id', 'resource', 'resource_id'] },
    { columns: ['client_id', 'actor_id'] },
  ],
});
