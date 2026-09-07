import type { FieldDef } from '$lib/components/form';

/** Field declarations for the MCP server form (FormBuilder, L-17); shared by new + edit. */
export const mcpFields: FieldDef[] = [
  { name: 'name', type: 'string', label: 'Nama', required: true, maxlength: 191 },
  {
    name: 'code',
    type: 'string',
    label: 'Kode',
    required: true,
    pattern: '[a-z0-9]+(-[a-z0-9]+)*',
    maxlength: 40,
    hint: 'Huruf kecil/angka/tanda hubung. Nama tool di kawat: ext_<kode>__<tool>',
  },
  {
    name: 'transport',
    type: 'select',
    label: 'Transport',
    required: true,
    options: [
      { value: 'http', label: 'Streamable HTTP (disarankan)' },
      { value: 'sse', label: 'SSE (lama)' },
    ],
  },
  {
    name: 'url',
    type: 'string',
    label: 'URL',
    required: true,
    maxlength: 512,
    placeholder: 'https://mcp.contoh.id/mcp',
  },
  {
    name: 'headers',
    type: 'text',
    label: 'Header tambahan (opsional)',
    rows: 3,
    span: 2,
    hint: 'Satu per baris, "Nama: nilai" — mis. Authorization: Bearer xxx. Nilai disimpan sebagai rahasia dan ditampilkan sebagai ***; biarkan *** untuk mempertahankannya.',
  },
  { name: 'enabled', type: 'boolean', label: 'Aktif — tool-nya ditawarkan ke asisten' },
];

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
