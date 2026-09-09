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
    // Extension point 6: the settings form renders this beside "Save" and POSTs it without a
    // page load. Same probe as the provider page's button, aimed at the settings-based provider.
    actions: [
      {
        key: 'test',
        label: { id: 'Uji koneksi', en: 'Test connection' },
        endpoint: '/v1/m/ai/settings/test',
        permission: 'ai.provider.manage',
        note: {
          id: 'Menguji base URL + key yang tersimpan di bagian ini (bukan profil di Penyedia AI).',
          en: 'Tests the base URL + key stored in this section (not the AI providers profiles).',
        },
      },
    ],
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
          id: 'mis. https://api.openai.com/v1 atau proxy kompatibel. Kosong = AI_API_BASE_URL dari .env, lalu https://api.openai.com/v1',
          en: 'e.g. https://api.openai.com/v1 or a compatible proxy. Empty = AI_API_BASE_URL from .env, then https://api.openai.com/v1',
        },
        default: 'https://api.openai.com/v1',
        max: 512,
        order: 1,
      },
      {
        key: 'ai.key',
        type: 'secret',
        title: { id: 'API key', en: 'API key' },
        note: {
          id: 'Kosong = AI_API_KEY dari .env',
          en: 'Empty = AI_API_KEY from .env',
        },
        order: 2,
      },
      {
        key: 'ai.model',
        type: 'string',
        title: { id: 'Model baku', en: 'Default model' },
        note: {
          id: 'Kosong = AI_MODEL dari .env, lalu gpt-4o-mini',
          en: 'Empty = AI_MODEL from .env, then gpt-4o-mini',
        },
        default: 'gpt-4o-mini',
        max: 120,
        order: 3,
      },
      {
        key: 'ai.preferred_endpoint',
        type: 'select',
        title: { id: 'Endpoint provider', en: 'Provider endpoint' },
        note: {
          id: 'Otomatis: coba /responses lebih dulu, turun ke /chat/completions bila provider menjawab 404/405 (hasilnya diingat sebentar, jadi tidak diulang tiap chat). Pilih manual bila Anda sudah tahu kemampuan provider. Berlaku untuk penyedia dari bagian ini; profil di Penyedia AI memakai hasil Uji koneksi masing-masing.',
          en: 'Automatic: try /responses first and fall back to /chat/completions when the provider answers 404/405 (the answer is remembered briefly, so it is not retried on every chat). Pin it when you already know what the provider supports. Applies to the provider configured here; profiles under AI providers use their own connection test.',
        },
        default: 'auto',
        options: [
          { value: 'auto', label: { id: 'Otomatis (disarankan)', en: 'Automatic (recommended)' } },
          { value: 'responses', label: { id: '/responses', en: '/responses' } },
          {
            value: 'chat_completions',
            label: { id: '/chat/completions', en: '/chat/completions' },
          },
        ],
        order: 4,
      },
      {
        key: 'ai.reasoning_effort',
        type: 'select',
        title: { id: 'Upaya reasoning', en: 'Reasoning effort' },
        note: {
          id: 'Hanya untuk penyedia /responses yang mendukung reasoning. "Ikut penyedia" tidak mengirim apa pun — model bernalar sebanyak bawaannya, dan token itu ditagih: satu jawaban 10 token bisa memakai 261 token reasoning. Turunkan bila biaya lebih penting daripada kedalaman jawaban.',
          en: 'Only for /responses providers that support reasoning. "Provider default" sends nothing — the model thinks as much as it likes, and those tokens are billed: a 10-token answer can spend 261 reasoning tokens. Lower it when cost matters more than depth.',
        },
        default: 'provider',
        options: [
          { value: 'provider', label: { id: 'Ikut penyedia', en: 'Provider default' } },
          { value: 'minimal', label: { id: 'Minimal', en: 'Minimal' } },
          { value: 'low', label: { id: 'Rendah', en: 'Low' } },
          { value: 'medium', label: { id: 'Sedang', en: 'Medium' } },
          { value: 'high', label: { id: 'Tinggi', en: 'High' } },
        ],
        order: 5,
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
        order: 6,
      },
      {
        key: 'ai.max_tokens',
        type: 'number',
        title: { id: 'Maks. token keluaran', en: 'Max output tokens' },
        default: 1024,
        min: 16,
        max: 128000,
        order: 7,
      },
      {
        key: 'ai.log_retention_days',
        type: 'number',
        title: { id: 'Retensi log AI (hari)', en: 'AI log retention (days)' },
        default: 30,
        min: 1,
        max: 3650,
        order: 8,
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
        order: 9,
      },
      {
        key: 'ai.price_out_per_mtok',
        type: 'number',
        title: { id: 'Harga output / 1M token', en: 'Output price / 1M tokens' },
        default: 0,
        min: 0,
        order: 10,
      },
      {
        key: 'ai.tools_enable',
        type: 'boolean',
        title: {
          id: 'Izinkan asisten memanggil tool modul',
          en: 'Let the assistant call module tools',
        },
        note: {
          id: 'Tool dari api/tools.ts modul (titik perluasan 8) ditawarkan ke model; tetap tunduk izin user dan tenant. Hanya berlaku bila penyedianya mendukung tools — halaman Penyedia AI menandainya per penyedia setelah Uji koneksi.',
          en: 'Tools from module api/tools.ts (extension point 8) are offered to the model; still bound by user permission and tenant. Only has an effect when the provider supports tools — the AI providers page marks this per provider after a connection test.',
        },
        default: true,
        order: 11,
      },
      {
        key: 'ai.quota_tokens_month',
        type: 'number',
        title: { id: 'Kuota token tenant / bulan', en: 'Tenant token quota / month' },
        note: {
          id: 'Total token (masuk + keluar) semua pengguna tenant per bulan kalender UTC; 0 = tanpa batas (H-14).',
          en: 'Total tokens (in + out) of all tenant users per UTC calendar month; 0 = unlimited (H-14).',
        },
        default: 0,
        min: 0,
        order: 12,
      },
      {
        key: 'ai.quota_tokens_user_month',
        type: 'number',
        title: { id: 'Kuota token per pengguna / bulan', en: 'Per-user token quota / month' },
        note: { id: '0 = tanpa batas.', en: '0 = unlimited.' },
        default: 0,
        min: 0,
        order: 13,
      },
    ],
  },
]);
