import { defineConfig } from '@core/module-kit';

/** Configuration section (extension point 6): appears in the admin settings form automatically (E-3). */
export default defineConfig('Dummy', [
  {
    section: 'dummy',
    title: { id: 'Modul Dummy', en: 'Dummy module' },
    note: {
      id: 'Contoh section konfigurasi dari modul.',
      en: 'A sample configuration section from a module.',
    },
    order: 500,
    fields: [
      {
        key: 'dummy.greeting',
        type: 'string',
        title: { id: 'Sapaan', en: 'Greeting' },
        default: 'Halo dari Dummy',
        public: true,
        max: 120,
      },
      {
        key: 'dummy.max_notes',
        type: 'number',
        title: { id: 'Maks. catatan', en: 'Max notes' },
        default: 100,
        min: 1,
        max: 10000,
      },
      {
        key: 'dummy.api_key',
        type: 'secret',
        title: { id: 'Kunci API (contoh)', en: 'API key (sample)' },
      },
    ],
  },
]);
