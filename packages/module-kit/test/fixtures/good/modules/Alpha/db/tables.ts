import { col, defineTable } from '../../../../../../../db/src/descriptor.ts';
export default [
  defineTable({ name: 'alpha_items', tenant: true, columns: { label: col.varchar(50) } }),
];
