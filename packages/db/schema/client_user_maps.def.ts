import { col, defineTable } from '../src/descriptor.ts';

/** Which users may act in which tenant (B-2, B-4). The source of truth for validating X-Client-ID. */
export const clientUserMaps = defineTable({
  name: 'client_user_maps',
  tenant: true,
  columns: {
    user_id: col.uuid().references('users', 'cascade'),
    /** Tenant opened after login when the user has several (B-4). */
    is_default: col.boolean().default(false),
  },
  indexes: [{ columns: ['client_id', 'user_id'], unique: true }],
});
