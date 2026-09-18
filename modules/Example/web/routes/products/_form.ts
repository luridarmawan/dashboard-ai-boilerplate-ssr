import type { Translate } from '@core/i18n';
import type { FieldDef } from '$lib/components/form';

/** Field declarations for the product form (FormBuilder, L-17); shared by new + edit. */
export function productFields(t: Translate): FieldDef[] {
  return [
    {
      name: 'name',
      type: 'string',
      label: t('example.admin.form.name'),
      required: true,
      minlength: 2,
      maxlength: 191,
    },
    {
      name: 'slug',
      type: 'string',
      label: t('example.admin.slug'),
      required: true,
      pattern: '[a-z0-9]+(-[a-z0-9]+)*',
      hint: t('example.admin.form.slug_hint'),
    },
    {
      name: 'price',
      type: 'number',
      label: t('example.admin.form.price'),
      required: true,
      min: 0,
      step: 500,
    },
    { name: 'sort', type: 'number', label: t('example.admin.form.sort'), min: 0, step: 1 },
    { name: 'featured', type: 'boolean', label: t('example.admin.form.featured') },
    {
      name: 'imageUrl',
      type: 'string',
      label: t('example.admin.form.image_url'),
      maxlength: 512,
    },
    {
      name: 'summary',
      type: 'text',
      label: t('example.admin.form.summary'),
      rows: 2,
      maxlength: 512,
    },
    { name: 'description', type: 'markdown', label: t('example.admin.form.description') },
  ];
}
