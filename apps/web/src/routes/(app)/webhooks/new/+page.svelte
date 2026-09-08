<script lang="ts">
import { FormBuilder } from '$lib/components/form';
import { useT } from '$lib/i18n';
import { webhookFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('webhooks.add')}</title></svelte:head>

<div class="page">
  <h1>{t('webhooks.add')}</h1>
  <p class="text-sm text-muted-foreground">{t('webhooks.new.lead')}</p>
  <FormBuilder fields={webhookFields(data.events, t)} values={(form?.values as Record<string, unknown> | undefined) ?? { enabled: true, events: ['*'] }} errors={fieldErrors} csrf={data.csrf} columns={2} submitLabel={t('common.save')} cancelHref="/webhooks" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
