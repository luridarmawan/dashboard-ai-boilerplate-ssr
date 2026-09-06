import { defineLayouts } from '../../../../../src/contract.ts';

export default defineLayouts('Alpha', [
  {
    id: 'alpha.stack',
    kind: 'auth',
    name: { id: 'Tumpuk', en: 'Stack' },
    component: 'web/layouts/Stack.svelte',
  },
]);
