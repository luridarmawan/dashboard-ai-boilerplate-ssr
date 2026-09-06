import { defineWidgets } from '../../../../../src/contract.ts';

export default defineWidgets('Alpha', [
  {
    id: 'alpha.summary',
    title: { id: 'Ringkasan', en: 'Summary' },
    component: 'web/widgets/Summary.svelte',
    permission: 'alpha.item.read',
  },
]);
