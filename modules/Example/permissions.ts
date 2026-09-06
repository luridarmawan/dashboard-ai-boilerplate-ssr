import { CORE_ACTIONS, definePermissions } from '@core/module-kit';

/** Permissions (extension point 5): `example.product.*`, `example.inquiry.*`, `example.testimonial.*`. */
export default definePermissions('Example', [
  { resource: 'example.product', actions: CORE_ACTIONS, name: { id: 'Produk', en: 'Products' } },
  {
    resource: 'example.inquiry',
    actions: ['read', 'manage'],
    name: { id: 'Pesan masuk', en: 'Inquiries' },
  },
  {
    resource: 'example.testimonial',
    actions: CORE_ACTIONS,
    name: { id: 'Testimoni', en: 'Testimonials' },
  },
]);
