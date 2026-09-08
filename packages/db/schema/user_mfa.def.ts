import { col, defineTable } from '../src/descriptor.ts';

/**
 * Two-factor authentication (PRD A-11). One row per user: the TOTP secret (base32; present from
 * setup, enforced once `enabled_at` is set), hashed single-use recovery codes, and the last
 * accepted time step so a code cannot be replayed. Global like `users`.
 */
export const userMfa = defineTable({
  name: 'user_mfa',
  tenant: false,
  softDelete: false,
  columns: {
    user_id: col.uuid().references('users', 'cascade'),
    secret: col.text(),
    enabled_at: col.datetime().nullable(),
    /** SHA-256 hashes of the unused recovery codes. */
    recovery_codes: col.json().nullable(),
    last_step: col.int().nullable(),
  },
  indexes: [{ columns: ['user_id'], unique: true }],
});

/**
 * Half-finished logins: password verified, second factor pending. The client holds a random
 * token (hashed here) for a few minutes; attempts are counted so codes cannot be brute-forced.
 */
export const mfaChallenges = defineTable({
  name: 'mfa_challenges',
  tenant: false,
  softDelete: false,
  columns: {
    user_id: col.uuid().references('users', 'cascade'),
    token_hash: col.identifier(64),
    expires_at: col.datetime(),
    attempts: col.int().default(0),
    ip: col.identifier(45).nullable(),
  },
  indexes: [{ columns: ['token_hash'], unique: true }, { columns: ['expires_at'] }],
});
