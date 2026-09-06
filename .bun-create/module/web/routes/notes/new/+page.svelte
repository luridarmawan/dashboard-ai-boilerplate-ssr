<script lang="ts">
import { FormBuilder } from '@core/ui';
import { useT } from '$lib/i18n';
import { fields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('hello.notes.new')}</title></svelte:head>

<div class="page">
  <h1>{t('hello.notes.new')}</h1>
  <FormBuilder {fields} values={(form?.values as Record<string, unknown> | undefined) ?? {}} errors={fieldErrors} csrf={data.csrf} columns={2} submitLabel={t('common.save')} cancelHref="/m/hello/notes" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
