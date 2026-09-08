<script lang="ts">
import { type FieldDef, FormBuilder } from '$lib/components/form';
import { useT } from '$lib/i18n';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const fields: FieldDef[] = $derived([
  { name: 'name', type: 'string', label: t('users.name'), required: true, maxlength: 191 },
  {
    name: 'email',
    type: 'email',
    label: t('users.email'),
    required: true,
    hint: t('users.new.email_hint'),
  },
  {
    name: 'password',
    type: 'password',
    label: t('auth.login.password'),
    minlength: 12,
    autocomplete: 'new-password',
    hint: t('users.new.password_hint'),
  },
  {
    name: 'locale',
    type: 'select',
    label: t('nav.language'),
    options: [
      { value: 'id', label: t('lang.id') },
      { value: 'en', label: t('lang.en') },
    ],
  },
  {
    name: 'groupIds',
    type: 'multiselect',
    label: t('users.groups'),
    span: 2,
    options: data.groups.map((g) => ({ value: g.id, label: g.name })),
  },
]);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('users.add')}</title></svelte:head>

<div class="page">
  <h1>{t('users.add')}</h1>
  <FormBuilder
    {fields}
    values={(form?.values as Record<string, unknown> | undefined) ?? { locale: 'id' }}
    errors={fieldErrors}
    csrf={data.csrf}
    columns={2}
    submitLabel={t('common.save')}
    cancelHref="/users"
    error={form?.error && form.code !== 'validation_failed' ? form.error : form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null}
  />
</div>
