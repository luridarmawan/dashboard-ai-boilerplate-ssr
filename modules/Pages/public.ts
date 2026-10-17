import { definePublicRoutes } from '@core/module-kit';

/**
 * Public pages (extension point 13). Pages live at the ROOT of the site (`/about-us`), a shape no
 * module can declare as a route — so the module ships one 404 handler instead. Once an admin
 * picks "Pages — /pages" under Settings → Application → 404 handler, every unknown URL is offered
 * to it: a published page answers 200, an old permalink answers 301 to the current one, anything
 * else falls through to the built-in 404. A direct visit to `/pages` is itself a 404.
 */
export default definePublicRoutes('Pages', [
  { path: '/pages', dir: 'web/public/resolve', sitemap: false, notFound: true },
]);
