import { defineMenu } from '@core/module-kit';

/** Menu (extension point 4). */
export default defineMenu('Hello', [
  {
    id: 'hello.notes',
    label: { id: 'Notes', en: 'Notes' },
    href: '/m/hello/notes',
    icon: 'list',
    permission: 'hello.note.read',
    order: 200,
  },
]);
