import { CORE_ACTIONS, type PermissionDef } from '@core/module-kit';
import { modulePermissions } from '@core/module-kit/registry';

/**
 * The permission REGISTRY (PRD C-4): the closed list of resources and actions that exist.
 * Core declares its own here; modules add theirs through `permissions.ts` (extension point 5)
 * and arrive via modules:sync. The UI's permission editor lists exactly this, and the seed
 * validates against it — a resource name is never "just a convention".
 */

export const CORE_PERMISSIONS: readonly PermissionDef[] = [
  {
    resource: 'user',
    /**
     * `impersonate` (D-6) is an extra verb, not one of the CRUD four: acting as someone else is
     * not editing them. Like every action it is implied by `user.manage` and the wildcards, and
     * the endpoint additionally refuses a target who holds permissions the caller does not (C-5).
     */
    actions: [...CORE_ACTIONS, 'impersonate'],
    name: { id: 'Pengguna', en: 'Users' },
  },
  {
    resource: 'group',
    actions: CORE_ACTIONS,
    name: { id: 'Grup & izin', en: 'Groups & permissions' },
  },
  { resource: 'client', actions: CORE_ACTIONS, name: { id: 'Tenant', en: 'Tenants' } },
  {
    resource: 'config',
    actions: ['read', 'edit', 'manage'],
    name: { id: 'Konfigurasi', en: 'Configuration' },
  },
  { resource: 'module', actions: ['read', 'manage'], name: { id: 'Modul', en: 'Modules' } },
  { resource: 'theme', actions: ['read', 'manage'], name: { id: 'Tema', en: 'Themes' } },
  { resource: 'audit', actions: ['read'], name: { id: 'Log audit', en: 'Audit log' } },
  {
    resource: 'mail',
    actions: ['read', 'manage'],
    name: { id: 'Outbox email', en: 'Email outbox' },
  },
  {
    resource: 'webhook',
    /** read = see registrations and deliveries; manage = create/edit/test/retry/delete (J-5). */
    actions: ['read', 'manage'],
    name: { id: 'Webhook keluar', en: 'Outgoing webhooks' },
  },
  {
    resource: 'queue',
    /** read = see the job queue and its dead letters; manage = retry / delete (P2 queue). */
    actions: ['read', 'manage'],
    name: { id: 'Antrean pekerjaan', en: 'Job queue' },
  },
  {
    resource: 'file',
    /** create = upload own files; read = fetch others' private files; manage = list/delete any (Q-16). */
    actions: ['read', 'create', 'manage'],
    name: { id: 'Berkas unggahan', en: 'Uploaded files' },
  },
];

export interface RegistryEntry extends PermissionDef {
  readonly module: string;
}

/** Every resource, core first then modules in init order. */
export function permissionRegistry(): readonly RegistryEntry[] {
  return [...CORE_PERMISSIONS.map((p) => ({ ...p, module: 'core' })), ...modulePermissions];
}

/** Flat list of every concrete `resource.action` that exists right now. */
export function allPermissionStrings(): string[] {
  const out: string[] = [];
  for (const e of permissionRegistry()) for (const a of e.actions) out.push(`${e.resource}.${a}`);
  return out.sort();
}

/** Is this concrete permission (no wildcards) known to the registry? */
export function isRegistered(permission: string): boolean {
  return allPermissionStrings().includes(permission);
}
