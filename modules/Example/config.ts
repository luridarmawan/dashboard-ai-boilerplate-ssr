import { defineConfig } from '@core/module-kit';

/** Configuration (extension point 6): what an admin tunes on the storefront without a deploy. */
export default defineConfig('Example', [
  {
    section: 'example',
    title: { id: 'Landing Example', en: 'Example landing' },
    note: {
      id: 'Teks & perilaku etalase publik. Teks lain lewat i18n.',
      en: 'Storefront copy & behaviour. Other copy lives in i18n.',
    },
    order: 400,
    fields: [
      {
        key: 'example.brand_name',
        type: 'string',
        title: { id: 'Nama merek', en: 'Brand name' },
        default: 'Kopi Nusantara',
        public: true,
        max: 120,
        order: 0,
      },
      {
        key: 'example.tagline',
        type: 'string',
        title: { id: 'Tagline hero', en: 'Hero tagline' },
        default: null,
        public: true,
        max: 191,
        order: 1,
      },
      {
        key: 'example.contact_email',
        type: 'string',
        title: { id: 'Email penerima inquiry', en: 'Inquiry recipient email' },
        note: {
          id: 'Kosong = tidak ada email, hanya tersimpan.',
          en: 'Empty = stored only, no email.',
        },
        default: null,
        max: 191,
        order: 2,
      },
      {
        key: 'example.show_pricing',
        type: 'boolean',
        title: { id: 'Tampilkan bagian harga', en: 'Show pricing section' },
        default: true,
        public: true,
        order: 3,
      },
      {
        key: 'example.inquiry_rate_limit',
        type: 'string',
        title: { id: 'Rate limit form kontak', en: 'Contact form rate limit' },
        default: '5/3600',
        max: 20,
        order: 4,
      },
    ],
  },
]);
