import { col, defineTable } from '../src/descriptor.ts';

/**
 * Invitation links (PRD A-13): an admin invites an e-mail address into the ACTIVE tenant; the
 * invitee registers through `/join/<code>` even when self-service sign-up is off. The client holds
 * the random code, the row holds its SHA-256 (like every other token). One row per invitation:
 * re-inviting the same address revokes the pending one. Validity comes from
 * `security.invitation_hours` at creation time.
 *
 * Global like `sessions`, with an explicit `client_id`: the code is looked up WITHOUT a tenant
 * (the invitee has none yet), which a tenant table could not index (B-0). Admin routes filter by
 * `client_id` explicitly and are guarded by `user.create` in the active tenant.
 */
export const invitations = defineTable({
  name: 'invitations',
  tenant: false,
  softDelete: false,
  columns: {
    client_id: col.uuid().references('clients', 'cascade'),
    email: col.identifier(191),
    token_hash: col.identifier(64),
    invited_by: col.uuid().references('users', 'set null').nullable(),
    expires_at: col.datetime(),
    accepted_at: col.datetime().nullable(),
    accepted_user_id: col.uuid().references('users', 'set null').nullable(),
    revoked_at: col.datetime().nullable(),
  },
  indexes: [
    { columns: ['token_hash'], unique: true },
    { columns: ['client_id', 'email'] },
    { columns: ['expires_at'] },
  ],
});
