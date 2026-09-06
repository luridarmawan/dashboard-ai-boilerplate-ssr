import { defineLayouts } from '@core/module-kit';

/**
 * A custom dashboard layout from outside core (extension point 15, PRD L-7). Any theme —
 * including core's — may map a variant to `dummy.two-column`; no page changes (gate M2 #5).
 */
export default defineLayouts('Dummy', [
  {
    id: 'dummy.two-column',
    kind: 'dashboard',
    name: { id: 'Dua kolom', en: 'Two column' },
    description: {
      id: 'Navigasi kiri sempit, konten dua kolom.',
      en: 'Narrow left nav, two-column content.',
    },
    component: 'web/layouts/TwoColumn.svelte',
  },
]);
