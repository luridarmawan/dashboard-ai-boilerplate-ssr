import { definePublicRoutes } from '@core/module-kit';

/** Public page (extension point 13) at /hello, no session, public layout of the active theme. */
export default definePublicRoutes('Hello', [
  { path: '/hello', dir: 'web/public/home', sitemap: true },
]);
