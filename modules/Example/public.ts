import { definePublicRoutes } from '@core/module-kit';

/** Public pages (extension point 13): the storefront lives outside /m and needs no session. */
export default definePublicRoutes('Example', [
  { path: '/example', dir: 'web/public/landing', sitemap: true },
  // R-9: a SECOND arrangement of the same data — catalogue instead of storefront. Both are
  // landing candidates (`app.landing_route`), which is the point: one module, more than one
  // public page shape, and the admin picks which one answers `/` without a deploy (F-5).
  { path: '/catalog', dir: 'web/public/catalog', sitemap: true },
  { path: '/product/[slug]', dir: 'web/public/product/[slug]', sitemap: false },
]);
