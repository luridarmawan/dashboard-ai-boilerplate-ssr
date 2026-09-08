import { col, defineTable } from '../src/descriptor.ts';

/**
 * External identities linked to a user (PRD A-8). The link key is the provider's stable subject
 * id, never the e-mail: a Google account keeps signing in to the same user after its address
 * changes, and a *different* Google account with a recycled address cannot take the user over.
 * `email` is what the provider reported at link time, kept for the admin view. Global like `users`.
 */
export const oauthAccounts = defineTable({
  name: 'oauth_accounts',
  tenant: false,
  softDelete: false,
  columns: {
    user_id: col.uuid().references('users', 'cascade'),
    /** `google` today; the column leaves room for GitHub/Microsoft (P2). */
    provider: col.identifier(32),
    provider_user_id: col.varchar(191),
    email: col.identifier(191).nullable(),
    last_login_at: col.datetime().nullable(),
  },
  indexes: [{ columns: ['provider', 'provider_user_id'], unique: true }, { columns: ['user_id'] }],
});
