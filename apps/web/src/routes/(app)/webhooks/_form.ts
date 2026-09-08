import type { FieldDef } from '$lib/components/form';

/** Field declarations for the webhook form (FormBuilder, L-17); shared by new + edit. */
export function webhookFields(events: readonly string[]): FieldDef[] {
  return [
    { name: 'name', type: 'string', label: 'Nama', required: true, maxlength: 191 },
    {
      name: 'url',
      type: 'string',
      label: 'URL tujuan',
      required: true,
      maxlength: 512,
      placeholder: 'https://hooks.contoh.id/dab',
      span: 2,
      hint: 'Menerima POST JSON dengan header X-DAB-Event, X-DAB-Delivery, X-DAB-Timestamp, X-DAB-Signature (HMAC-SHA256 dari "<timestamp>.<body>" memakai secret).',
    },
    {
      name: 'events',
      type: 'multiselect',
      label: 'Event',
      required: true,
      span: 2,
      options: [
        { value: '*', label: '* — semua event' },
        ...events.map((e) => ({ value: e, label: e })),
      ],
    },
    { name: 'enabled', type: 'boolean', label: 'Aktif — event dikirim' },
  ];
}
