import { col, defineTable } from '../src/descriptor.ts';

/** Group membership; users inherit permissions through it (C-3). */
export const groupUserMaps = defineTable({
  name: 'group_user_maps',
  tenant: true,
  softDelete: false,
  columns: {
    group_id: col.uuid().references('groups', 'cascade'),
    user_id: col.uuid().references('users', 'cascade'),
  },
  indexes: [
    { columns: ['client_id', 'group_id', 'user_id'], unique: true },
    { columns: ['client_id', 'user_id'] },
  ],
});
