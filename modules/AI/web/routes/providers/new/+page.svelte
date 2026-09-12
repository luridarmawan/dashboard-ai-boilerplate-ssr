<script lang="ts">
import { FormBuilder } from '$lib/components/form';
import { useT } from '$lib/i18n';
import { providerFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('ai.providers.new')}</title></svelte:head>

<div class="page">
  <h1>{t('ai.providers.new')}</h1>
  <p class="text-sm text-muted-foreground">{t('ai.providers.new_hint')}</p>
  <FormBuilder fields={providerFields(t)} values={(form?.values as Record<string, unknown> | undefined) ?? { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', enabled: true }} errors={fieldErrors} csrf={data.csrf} columns={2} submitLabel={t('common.save')} cancelHref="/m/ai/providers" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
