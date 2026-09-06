import { defineWidgets } from '@core/module-kit';

/** Dashboard widget (extension point 11): storefront at a glance. */
export default defineWidgets('Example', [
  {
    id: 'example.storefront',
    title: { id: 'Etalase', en: 'Storefront' },
    component: 'web/widgets/Storefront.svelte',
    permission: 'example.product.read',
    order: 110,
    size: 'sm',
  },
]);
