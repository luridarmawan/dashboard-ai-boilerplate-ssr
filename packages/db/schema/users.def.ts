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
    /**
     * The language the user CHOSE (K-2). NULL = never chosen: the request then falls through to
     * the `crk_lang` cookie, `Accept-Language` and `app.default_locale`, so an account keeps the
     * language it was reading the site in instead of jumping to a hard-coded one on login.
     */
    locale: col.identifier(8).nullable(),
    theme: col.identifier(64).nullable(),
    /** Sidebar rail state (F-8): follows the user across devices, like `theme`. */
    sidebar_collapsed: col.boolean().default(false),
    /** Superadmin is a database flag, bootstrapped from env once (C-5) — never a restart. */
    is_superadmin: col.boolean().default(false),
    email_verified_at: col.datetime().nullable(),
    last_login_at: col.datetime().nullable(),
    /** Client address of that login (first X-Forwarded-For hop behind the proxy); IPv6 fits in 45. */
    last_login_ip: col.identifier(45).nullable(),
    /**
     * Newest request of any session (D-5), throttled like `sessions.last_seen_at` — but kept on
     * the account, so it outlives the purge of expired sessions. Login counts as activity too.
     */
    last_active_at: col.datetime().nullable(),
    last_active_ip: col.identifier(45).nullable(),
  },
  indexes: [{ columns: ['email'], unique: true }],
});
