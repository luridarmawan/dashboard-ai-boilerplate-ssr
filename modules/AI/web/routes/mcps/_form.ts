import type { Translate } from '@core/i18n';
import type { FieldDef } from '$lib/components/form';

/** Field declarations for the MCP server form (FormBuilder, L-17); shared by new + edit. */
export function mcpFields(t: Translate): FieldDef[] {
  return [
    { name: 'name', type: 'string', label: t('ai.mcps.name'), required: true, maxlength: 191 },
    {
      name: 'code',
      type: 'string',
      label: t('ai.mcps.code'),
      required: true,
      pattern: '[a-z0-9]+(-[a-z0-9]+)*',
      maxlength: 40,
      hint: t('ai.mcps.form.code_hint'),
    },
    {
      name: 'transport',
      type: 'select',
      label: t('ai.mcps.transport'),
      required: true,
      options: [
        { value: 'http', label: t('ai.mcps.form.transport_http') },
        { value: 'sse', label: t('ai.mcps.form.transport_sse') },
      ],
    },
    {
      name: 'url',
      type: 'string',
      label: t('ai.mcps.url'),
      required: true,
      maxlength: 512,
      placeholder: t('ai.mcps.form.url_placeholder'),
    },
    {
      name: 'headers',
      type: 'text',
      label: t('ai.mcps.form.headers'),
      rows: 3,
      span: 2,
      hint: t('ai.mcps.form.headers_hint'),
    },
    { name: 'enabled', type: 'boolean', label: t('ai.mcps.form.enabled') },
  ];
}

/** `Name: value` lines → record; `***` values survive so the API keeps the stored secret. */
export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function headerLines(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}
