<script lang="ts">
import { type FieldDef, FormBuilder } from '$lib/components/form';
import { Card } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { LayoutData } from '../../$types';
import type { ActionData } from './$types';

let { data, form }: { data: LayoutData; form: ActionData } = $props();
const t = useT();
const fields: FieldDef[] = [
  {
    name: 'name',
    type: 'string',
    label: t('examples.form.name'),
    required: true,
    minlength: 3,
    maxlength: 120,
  },
  {
    name: 'sku',
    type: 'string',
    label: 'SKU',
    required: true,
    pattern: '[A-Z0-9\\-]{3,20}',
    hint: t('examples.form.sku_hint'),
  },
  {
    name: 'category',
    type: 'select',
    label: t('examples.category'),
    required: true,
    options: [
      { value: 'minuman', label: 'Minuman' },
      { value: 'bumbu', label: 'Bumbu' },
      { value: 'pemanis', label: 'Pemanis' },
    ],
  },
  {
    name: 'price',
    type: 'number',
    label: t('examples.form.price'),
    required: true,
    min: 0,
    step: 500,
  },
  { name: 'stock', type: 'number', label: t('examples.stock'), required: true, min: 0, step: 1 },
  { name: 'releasedAt', type: 'date', label: t('examples.form.released_at') },
  { name: 'published', type: 'boolean', label: t('examples.form.published') },
  {
    name: 'tags',
    type: 'multiselect',
    label: 'Tag',
    options: ['organik', 'lokal', 'promo', 'baru', 'terbatas'].map((v) => ({ value: v, label: v })),
  },
  { name: 'image', type: 'file', label: t('examples.form.image'), accept: 'image/*' },
  { name: 'description', type: 'text', label: t('examples.form.description'), rows: 3 },
  { name: 'notes', type: 'markdown', label: t('examples.form.notes') },
];
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('examples.prefix')} · {t('examples.form.title')}</title></svelte:head>

<div class="page">
  <h1>{t('examples.form.title')}</h1>
  <p class="text-muted-foreground">{t('examples.form.lead')}</p>
  <Card>
    <FormBuilder {fields} values={(form?.values as Record<string, unknown> | undefined) ?? { category: 'minuman', stock: 0, price: 0 }} errors={fieldErrors} csrf={data.csrf} columns={2} submitLabel={t('examples.form.submit')} cancelHref="/examples" notice={form?.saved ? t('examples.form.valid_notice') : null} error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
  </Card>
</div>
