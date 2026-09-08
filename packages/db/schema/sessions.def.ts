import { col, defineTable } from '../src/descriptor.ts';

/**
 * Server-side sessions, the default `SESSION_DRIVER=database` (A-3, Decision M). The cookie
 * holds a random secret; only its SHA-256 is stored, so a database leak yields no usable
 * sessions. `client_id` is the ACTIVE tenant of this session (B-2), not ownership.
 */
export const sessions = defineTable({
  name: 'sessions',
  tenant: false,
  softDelete: false,
  columns: {
    user_id: col.uuid().references('users', 'cascade'),
    client_id: col.uuid().references('clients', 'set null').nullable(),
    token_hash: col.identifier(64),
    expires_at: col.datetime(),
    last_seen_at: col.datetime(),
    ip: col.identifier(45).nullable(),
    user_agent: col.varchar(512).nullable(),
    revoked_at: col.datetime().nullable(),
    /** Set when a superadmin opened this session AS the user (D-6); the banner and audit read it. */
    impersonator_id: col.uuid().references('users', 'set null').nullable(),
  },
  indexes: [
    { columns: ['token_hash'], unique: true },
    { columns: ['user_id'] },
    { columns: ['expires_at'] },
  ],
});
