import { col, defineTable } from '../src/descriptor.ts';

/** `resource.action` strings granted to a group (C-1, C-2); wildcards allowed (`*.*`, `user.*`, `*.read`). */
export const groupPermissions = defineTable({
  name: 'group_permissions',
  tenant: true,
  softDelete: false,
  columns: {
    group_id: col.uuid().references('groups', 'cascade'),
    permission: col.identifier(191),
  },
  indexes: [{ columns: ['client_id', 'group_id', 'permission'], unique: true }],
});
