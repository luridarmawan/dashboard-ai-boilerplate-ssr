import { defineConfig } from '@core/module-kit';

/**
 * AI configuration (H-1, H-2, H-5, M-3). The provider is DATA: any OpenAI-compatible endpoint.
 * Per tenant with global fallback like every other section.
 */
export default defineConfig('AI', [
  {
    section: 'ai',
    title: { id: 'AI', en: 'AI' },
    note: {
      id: 'Penyedia kompatibel-OpenAI. Kunci tidak pernah dikirim ke browser.',
      en: 'OpenAI-compatible provider. The key never reaches the browser.',
    },
    order: 30,
    fields: [
      {
        key: 'ai.enable',
        type: 'boolean',
        title: { id: 'Aktifkan asisten AI', en: 'Enable the AI assistant' },
        default: true,
        public: true,
        order: 0,
      },
      {
        key: 'ai.baseurl',
        type: 'string',
        title: { id: 'Base URL provider', en: 'Provider base URL' },
        note: {
          id: 'mis. https://api.openai.com/v1 atau proxy kompatibel',
          en: 'e.g. https://api.openai.com/v1 or a compatible proxy',
        },
        default: 'https://api.openai.com/v1',
        max: 512,
        order: 1,
      },
      { key: 'ai.key', type: 'secret', title: { id: 'API key', en: 'API key' }, order: 2 },
      {
        key: 'ai.model',
        type: 'string',
        title: { id: 'Model baku', en: 'Default model' },
        default: 'gpt-4o-mini',
        max: 120,
        order: 3,
      },
      {
        key: 'ai.system_prompt',
        type: 'text',
        title: { id: 'System prompt', en: 'System prompt' },
        note: {
          id: 'Disuntikkan bila request belum punya pesan system (H-5).',
          en: 'Injected when the request has no system message (H-5).',
        },
        default: 'Anda adalah asisten yang membantu, ringkas, dan menjawab dalam bahasa pengguna.',
        max: 4000,
        order: 4,
      },
      {
        key: 'ai.max_tokens',
        type: 'number',
        title: { id: 'Maks. token keluaran', en: 'Max output tokens' },
        default: 1024,
        min: 16,
        max: 128000,
        order: 5,
      },
      {
        key: 'ai.log_retention_days',
        type: 'number',
        title: { id: 'Retensi log AI (hari)', en: 'AI log retention (days)' },
        default: 30,
        min: 1,
        max: 3650,
        order: 6,
      },
      {
        key: 'ai.price_in_per_mtok',
        type: 'number',
        title: { id: 'Harga input / 1M token', en: 'Input price / 1M tokens' },
        note: {
          id: 'Untuk estimasi biaya; 0 = tidak dihitung.',
          en: 'For cost estimates; 0 = not computed.',
        },
        default: 0,
        min: 0,
        order: 7,
      },
      {
        key: 'ai.price_out_per_mtok',
        type: 'number',
        title: { id: 'Harga output / 1M token', en: 'Output price / 1M tokens' },
        default: 0,
        min: 0,
        order: 8,
      },
    ],
  },
]);
