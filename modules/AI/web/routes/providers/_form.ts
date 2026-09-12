import type { Translate } from '@core/i18n';
import type { FieldDef } from '$lib/components/form';

/** Field declarations for the provider profile form (FormBuilder, L-17); shared by new + edit. */
export function providerFields(t: Translate): FieldDef[] {
  return [
    { name: 'name', type: 'string', label: t('ai.providers.name'), required: true, maxlength: 191 },
    {
      name: 'code',
      type: 'string',
      label: t('ai.providers.code'),
      required: true,
      pattern: '[a-z0-9]+(-[a-z0-9]+)*',
      maxlength: 40,
      hint: t('ai.providers.form.code_hint'),
    },
    {
      name: 'baseUrl',
      type: 'string',
      label: t('ai.providers.form.base_url'),
      required: true,
      maxlength: 512,
      placeholder: 'https://api.openai.com/v1',
      span: 2,
    },
    {
      name: 'apiKey',
      type: 'password',
      label: t('ai.providers.form.api_key'),
      maxlength: 4000,
      autocomplete: 'off',
      hint: t('ai.providers.form.api_key_hint'),
    },
    {
      name: 'defaultModel',
      type: 'string',
      label: t('ai.providers.form.default_model'),
      required: true,
      maxlength: 120,
      placeholder: 'gpt-4o-mini',
    },
    {
      name: 'models',
      type: 'text',
      label: t('ai.providers.form.models'),
      rows: 6,
      span: 2,
      hint: t('ai.providers.form.models_hint'),
    },
    { name: 'enabled', type: 'boolean', label: t('ai.providers.form.enabled') },
    { name: 'isDefault', type: 'boolean', label: t('ai.providers.form.is_default') },
  ];
}

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
