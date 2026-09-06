import { definePublicRoutes } from '@core/module-kit';

/** Public pages (extension point 13): the storefront lives outside /m and needs no session. */
export default definePublicRoutes('Example', [
  { path: '/example', dir: 'web/public/landing', sitemap: true },
  { path: '/product/[slug]', dir: 'web/public/product/[slug]', sitemap: false },
]);
