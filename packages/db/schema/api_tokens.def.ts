import { col, defineTable } from '../src/descriptor.ts';

/** Bearer tokens for non-browser clients (A-4): own expiry, own scopes, revocable. Only the hash is stored. */
export const apiTokens = defineTable({
  name: 'api_tokens',
  tenant: false,
  columns: {
    user_id: col.uuid().references('users', 'cascade'),
    /** Tenant the token acts in; NULL = the user's default tenant at call time. */
    client_id: col.uuid().references('clients', 'set null').nullable(),
    name: col.varchar(100),
    token_hash: col.identifier(64),
    /** Permission strings this token is limited to; NULL = the user's full permissions. */
    scopes: col.json().nullable(),
    expires_at: col.datetime().nullable(),
    last_used_at: col.datetime().nullable(),
  },
  indexes: [{ columns: ['token_hash'], unique: true }, { columns: ['user_id'] }],
});
