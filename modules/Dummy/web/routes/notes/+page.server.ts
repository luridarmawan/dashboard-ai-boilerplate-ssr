import type { ServerLoad } from '@sveltejs/kit';

/**
 * Module page load (extension point 3). Served at /m/dummy/notes through the shim that
 * `modules:sync` generates into apps/web/src/routes/m/dummy/notes/. The typed API client and
 * the layout regions reach module pages with M1/M2; this page proves routing + SSR.
 */
export const load: ServerLoad = async ({ url }) => {
  return {
    module: 'Dummy',
    renderedAt: new Date().toISOString(),
    path: url.pathname,
  };
};
