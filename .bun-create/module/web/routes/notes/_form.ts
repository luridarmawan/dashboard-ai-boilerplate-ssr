import type { FieldDef } from '@core/ui';

export const fields: FieldDef[] = [
  { name: 'title', label: 'Title', type: 'string', required: true, maxlength: 191 },
  { name: 'body', label: 'Body', type: 'text', rows: 3 },
  { name: 'pinned', label: 'Pinned', type: 'boolean' },
];
