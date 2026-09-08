import type { FieldDef } from '$lib/components/form';

/** Field declarations for the provider profile form (FormBuilder, L-17); shared by new + edit. */
export const providerFields: FieldDef[] = [
  { name: 'name', type: 'string', label: 'Nama', required: true, maxlength: 191 },
  {
    name: 'code',
    type: 'string',
    label: 'Kode',
    required: true,
    pattern: '[a-z0-9]+(-[a-z0-9]+)*',
    maxlength: 40,
    hint: 'Huruf kecil/angka/tanda hubung; tercatat di setiap baris log AI.',
  },
  {
    name: 'baseUrl',
    type: 'string',
    label: 'Base URL (kompatibel-OpenAI)',
    required: true,
    maxlength: 512,
    placeholder: 'https://api.openai.com/v1',
    span: 2,
  },
  {
    name: 'apiKey',
    type: 'password',
    label: 'API key',
    maxlength: 4000,
    autocomplete: 'off',
    hint: 'Disimpan sebagai rahasia dan tidak pernah ditampilkan lagi; biarkan *** untuk mempertahankan.',
  },
  {
    name: 'defaultModel',
    type: 'string',
    label: 'Model baku',
    required: true,
    maxlength: 120,
    placeholder: 'gpt-4o-mini',
  },
  {
    name: 'models',
    type: 'text',
    label: 'Daftar model & harga',
    rows: 6,
    span: 2,
    hint: 'Satu per baris: model | label | harga input per 1M token | harga output per 1M token — mis. "gpt-4o-mini | GPT-4o mini | 0.15 | 0.60". Harga dalam mata uang yang Anda pakai; 0 = tidak dihitung.',
  },
  { name: 'enabled', type: 'boolean', label: 'Aktif — bisa dipilih di chat' },
  { name: 'isDefault', type: 'boolean', label: 'Jadikan baku untuk percakapan baru' },
];

export interface ModelLine {
  model: string;
  label?: string | null;
  priceIn?: number;
  priceOut?: number;
}

/** `model | label | in | out` lines → API models; malformed numbers become 0. */
export function parseModelLines(text: string): ModelLine[] {
  const out: ModelLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split('|').map((p) => p.trim());
    const model = parts[0] ?? '';
    if (!model) continue;
    const num = (v: string | undefined) => {
      const n = Number((v ?? '').replace(',', '.'));
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    out.push({
      model,
      label: parts[1] || null,
      priceIn: num(parts[2]),
      priceOut: num(parts[3]),
    });
  }
  return out;
}

export function modelLines(
  models: { model: string; label: string | null; priceIn: number; priceOut: number }[],
): string {
  return models
    .map((m) => `${m.model} | ${m.label ?? ''} | ${m.priceIn} | ${m.priceOut}`)
    .join('\n');
}
