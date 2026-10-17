import { defineMenu } from '@core/module-kit';

/** Dashboard menu (extension point 4). Shown only with the matching permission. */
export default defineMenu('Pages', [
  {
    id: 'pages.pages',
    label: { id: 'Halaman', en: 'Pages' },
    href: '/m/pages/pages',
    icon: 'file',
    permission: 'pages.page.read',
    order: 130,
  },
]);
