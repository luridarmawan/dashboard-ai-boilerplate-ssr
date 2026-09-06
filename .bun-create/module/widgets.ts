import { defineWidgets } from '@core/module-kit';

/** Dashboard widget (extension point 11), filtered by permission on the server. */
export default defineWidgets('Hello', [
  {
    id: 'hello.summary',
    title: { id: 'Notes', en: 'Notes' },
    component: 'web/widgets/Summary.svelte',
    permission: 'hello.note.read',
    order: 200,
    size: 'sm',
  },
]);
