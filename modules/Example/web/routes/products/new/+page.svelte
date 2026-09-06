<script lang="ts">
import { FormBuilder } from '$lib/components/form';
import { useT } from '$lib/i18n';
import { productFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('example.admin.new_product')}</title></svelte:head>

<div class="page">
  <h1>{t('example.admin.new_product')}</h1>
  <FormBuilder fields={productFields} values={(form?.values as Record<string, unknown> | undefined) ?? { sort: 100, price: 0 }} errors={fieldErrors} csrf={data.csrf} columns={2} submitLabel={t('common.save')} cancelHref="/m/example/products" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
