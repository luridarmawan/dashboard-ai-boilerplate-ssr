import { defineWidgets } from '@core/module-kit';

/**
 * Dashboard widgets (extension point 11, G-19). Shown only to users holding `dummy.note.read`;
 * the core dashboard filters and renders it on the server without knowing this module exists.
 */
export default defineWidgets('Dummy', [
  {
    id: 'dummy.notes_count',
    title: { id: 'Catatan', en: 'Notes' },
    component: 'web/widgets/NotesCount.svelte',
    permission: 'dummy.note.read',
    order: 100,
    size: 'sm',
  },
]);
