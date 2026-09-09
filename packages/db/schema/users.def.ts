import { col, defineTable } from '../src/descriptor.ts';

/**
 * Accounts (FR-A, FR-D). Global: a user may belong to several tenants through
 * `client_user_maps` (B-4), so the row itself carries no `client_id`.
 */
export const users = defineTable({
  name: 'users',
  tenant: false,
  columns: {
    /** Stored lower-cased; uniqueness is therefore case-insensitive regardless of collation. */
    email: col.identifier(191),
    /** Argon2id (A-1). NULL for accounts that only sign in through OAuth (A-8). */
    password_hash: col.text().nullable(),
    name: col.varchar(191),
    /** Optional contact number, free-form E.164-ish, max 32 chars (application-validated). */
    phone: col.varchar(32).nullable(),
    avatar_url: col.varchar(512).nullable(),
    locale: col.identifier(8).default('id'),
    theme: col.identifier(64).nullable(),
    /** Superadmin is a database flag, bootstrapped from env once (C-5) — never a restart. */
    is_superadmin: col.boolean().default(false),
    email_verified_at: col.datetime().nullable(),
    last_login_at: col.datetime().nullable(),
  },
  indexes: [{ columns: ['email'], unique: true }],
});
