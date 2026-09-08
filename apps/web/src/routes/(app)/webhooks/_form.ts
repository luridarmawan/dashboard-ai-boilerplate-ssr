import type { Translate } from '@core/i18n';
import type { FieldDef } from '$lib/components/form';

/** Field declarations for the webhook form (FormBuilder, L-17); shared by new + edit. */
export function webhookFields(events: readonly string[], t: Translate): FieldDef[] {
  return [
    { name: 'name', type: 'string', label: t('webhooks.name'), required: true, maxlength: 191 },
    {
      name: 'url',
      type: 'string',
      label: t('webhooks.form.url'),
      required: true,
      maxlength: 512,
      placeholder: 'https://hooks.contoh.id/dab',
      span: 2,
      hint: t('webhooks.form.url_hint'),
    },
    {
      name: 'events',
      type: 'multiselect',
      label: t('webhooks.events'),
      required: true,
      span: 2,
      options: [
        { value: '*', label: t('webhooks.form.all_events') },
        ...events.map((e) => ({ value: e, label: e })),
      ],
    },
    { name: 'enabled', type: 'boolean', label: t('webhooks.form.enabled') },
  ];
}
