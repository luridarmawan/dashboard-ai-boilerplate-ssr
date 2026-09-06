import { defineConfig } from '@core/module-kit';

/** Configuration (extension point 6) — appears in Settings automatically. */
export default defineConfig('Hello', [
  {
    section: 'hello',
    title: { id: 'Hello', en: 'Hello' },
    order: 600,
    fields: [
      {
        key: 'hello.page_size',
        type: 'number',
        title: { id: 'Baris per halaman', en: 'Rows per page' },
        default: 20,
        min: 5,
        max: 200,
      },
      {
        key: 'hello.greeting',
        type: 'string',
        title: { id: 'Sapaan widget', en: 'Widget greeting' },
        default: 'Halo dari Hello',
        public: true,
        max: 120,
      },
    ],
  },
]);
