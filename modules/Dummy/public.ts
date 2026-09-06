import { definePublicRoutes } from '@core/module-kit';

/** Public pages (extension point 13): served outside /m, no session, public shell + theme. */
export default definePublicRoutes('Dummy', [
  { path: '/hello-dummy', dir: 'web/public/hello', sitemap: true },
]);
