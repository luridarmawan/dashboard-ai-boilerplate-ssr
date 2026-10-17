<script lang="ts">
import { FormBuilder } from '@core/ui';
import { useT } from '$lib/i18n';
import { pageFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('pages.list.new')}</title></svelte:head>

<div class="page">
  <h1>{t('pages.list.new')}</h1>
  <FormBuilder fields={pageFields(t, { slug: true })} ajax values={(form?.values as Record<string, unknown> | undefined) ?? { status: 'draft' }} errors={fieldErrors} csrf={data.csrf} columns={2} submitLabel={t('common.save')} cancelHref="/m/pages/pages" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
