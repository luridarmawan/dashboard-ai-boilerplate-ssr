import { col, defineTable } from '../src/descriptor.ts';

/** Email verification tokens (A-6): same shape as reset tokens, separate table, separate lifetime. */
export const emailVerificationTokens = defineTable({
  name: 'email_verification_tokens',
  tenant: false,
  softDelete: false,
  columns: {
    user_id: col.uuid().references('users', 'cascade'),
    token_hash: col.identifier(64),
    expires_at: col.datetime(),
    used_at: col.datetime().nullable(),
  },
  indexes: [{ columns: ['token_hash'], unique: true }, { columns: ['user_id'] }],
});
