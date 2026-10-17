import { CORE_ACTIONS, definePermissions } from '@core/module-kit';

/** Permissions (extension point 5): `pages.page.read|create|edit|manage`. */
export default definePermissions('Pages', [
  { resource: 'pages.page', actions: CORE_ACTIONS, name: { id: 'Halaman', en: 'Pages' } },
]);
