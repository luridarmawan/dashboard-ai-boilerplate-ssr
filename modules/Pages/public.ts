import { definePublicRoutes } from '@core/module-kit';

/**
 * Public pages (extension point 13). Pages live at the ROOT of the site (`/about-us`), a shape no
 * module can declare as a route. Each page registers its URL in the core permalink registry
 * (PRD F-12) and this page — flagged `permalinks: true` — renders whatever registered URL the core
 * forwards to it; old URLs are answered with a 301 by the core itself. No setting is involved, and
 * the 404 handler stays free for modules whose URL shapes cannot be registered one by one. A
 * direct visit to `/pages` is a 404.
 */
export default definePublicRoutes('Pages', [
  { path: '/pages', dir: 'web/public/resolve', sitemap: false, permalinks: true },
]);
