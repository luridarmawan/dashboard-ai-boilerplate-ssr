import { defineMenu } from '@core/module-kit';

/** Menu contribution (extension point 4). Shown only when the user holds `dummy.note.read` (F-1). */
export default defineMenu('Dummy', [
  {
    id: 'dummy.notes',
    label: { id: 'Catatan', en: 'Notes' },
    href: '/m/dummy/notes',
    icon: 'edit',
    permission: 'dummy.note.read',
    order: 100,
  },
]);
