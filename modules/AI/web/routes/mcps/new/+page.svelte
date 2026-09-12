<script lang="ts">
import { FormBuilder } from '$lib/components/form';
import { useT } from '$lib/i18n';
import { mcpFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('ai.mcps.new')}</title></svelte:head>

<div class="page">
  <h1>{t('ai.mcps.new')}</h1>
  <FormBuilder fields={mcpFields(t)} values={(form?.values as Record<string, unknown> | undefined) ?? { transport: 'http', enabled: true }} errors={fieldErrors} csrf={data.csrf} columns={2} submitLabel={t('common.save')} cancelHref="/m/ai/mcps" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
