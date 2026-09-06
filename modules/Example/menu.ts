import { defineMenu } from '@core/module-kit';

/** Dashboard menu (extension point 4). Shown only with the matching permission (F-1). */
export default defineMenu('Example', [
  {
    id: 'example.products',
    label: { id: 'Produk', en: 'Products' },
    href: '/m/example/products',
    icon: 'tag',
    permission: 'example.product.read',
    order: 110,
  },
  {
    id: 'example.inquiries',
    label: { id: 'Pesan masuk', en: 'Inquiries' },
    href: '/m/example/inquiries',
    icon: 'mail',
    permission: 'example.inquiry.read',
    order: 120,
  },
]);
