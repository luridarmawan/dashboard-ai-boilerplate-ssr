import { col, defineTable } from '../../../../../../../db/src/descriptor.ts';
export default [defineTable({ name: 'notes', tenant: true, columns: { label: col.varchar(50) } })];
