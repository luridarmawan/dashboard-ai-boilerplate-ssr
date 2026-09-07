import { col, defineTable } from '../src/descriptor.ts';

/**
 * In-app notifications (PRD J-4): one row per recipient. Written by core and modules through the
 * `notify()` service (apps/api/src/notifications.ts), read by the bell in the dashboard header.
 * Tenant-scoped; `read_at` marks it seen; read rows are pruned by the retention job (M-3).
 */
export const notifications = defineTable({
  name: 'notifications',
  tenant: true,
  softDelete: false,
  columns: {
    user_id: col.uuid().references('users', 'cascade'),
    /** Dotted kind, e.g. `token.created`, `example.inquiry`, `module.toggled` — for icons/filters. */
    type: col.identifier(64),
    title: col.varchar(191),
    body: col.text().nullable(),
    /** Dashboard path to open, e.g. `/m/example/inquiries`. */
    link: col.varchar(512).nullable(),
    data: col.json().nullable(),
    read_at: col.datetime().nullable(),
  },
  indexes: [
    { columns: ['client_id', 'user_id', 'read_at', 'created_at'] },
    { columns: ['client_id', 'created_at'] },
  ],
});
