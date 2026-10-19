import { defineWidgets } from '@core/module-kit';

/**
 * Widgets (extension point 11). One dashboard card, and two pieces of the PUBLIC header: core
 * owns the header's places, modules fill them. Disable the module and the search box and the
 * cart icon disappear from every public page with it.
 */
export default defineWidgets('Example', [
  {
    id: 'example.storefront',
    title: { id: 'Etalase', en: 'Storefront' },
    component: 'web/widgets/Storefront.svelte',
    permission: 'example.product.read',
    order: 110,
    size: 'sm',
  },
  {
    id: 'example.header_search',
    title: { id: 'Pencarian produk', en: 'Product search' },
    component: 'web/widgets/HeaderSearch.svelte',
    slot: 'public-search',
    order: 100,
  },
  {
    id: 'example.header_cart',
    title: { id: 'Keranjang', en: 'Cart' },
    component: 'web/widgets/HeaderCart.svelte',
    slot: 'public-actions',
    order: 100,
  },
]);
