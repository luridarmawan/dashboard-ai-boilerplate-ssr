<script lang="ts">
import { type FieldDef, FormBuilder } from '$lib/components/form';
import { useT } from '$lib/i18n';
import type { LayoutData } from '../../$types';
import type { ActionData } from './$types';

let { data, form }: { data: LayoutData; form: ActionData } = $props();
const t = useT();
const fields: FieldDef[] = [
  {
    name: 'code',
    type: 'string',
    label: t('tenants.code'),
    required: true,
    minlength: 2,
    maxlength: 32,
    pattern: '[a-z][a-z0-9_\\-]*',
  },
  { name: 'name', type: 'string', label: t('tenants.name'), required: true, maxlength: 191 },
];
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('tenants.add')}</title></svelte:head>

<div class="page">
  <h1>{t('tenants.add')}</h1>
  <p class="text-sm text-muted-foreground">{t('tenants.new.lead_1')}<code>admin</code>{t('tenants.new.lead_2')}<code>user</code>{t('tenants.new.lead_3')}</p>
  <FormBuilder {fields} values={(form?.values as Record<string, unknown> | undefined) ?? {}} errors={fieldErrors} csrf={data.csrf} submitLabel={t('common.create')} cancelHref="/tenants" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
