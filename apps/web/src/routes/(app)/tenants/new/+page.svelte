<script lang="ts">
import { codeFromName } from '@core/contracts/code';
import { type FieldDef, FormBuilder } from '$lib/components/form';
import { useT } from '$lib/i18n';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const fields: FieldDef[] = $derived([
  { name: 'name', type: 'string', label: t('tenants.name'), required: true, maxlength: 191 },
  {
    name: 'code',
    type: 'string',
    label: t('tenants.code'),
    hint: t('tenants.code_hint'),
    minlength: 2,
    maxlength: 32,
    pattern: '[a-z][a-z0-9_\\-]*',
    autocomplete: 'off',
  },
  {
    name: 'parentId',
    type: 'select',
    label: t('tenants.parent'),
    hint: t('tenants.parent_hint'),
    options: data.parents,
  },
]);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);

/**
 * Progressive enhancement: with JavaScript the code follows the name as it is typed, until the
 * user edits the code box themselves — from then on it is theirs. Without JavaScript the box
 * stays empty and the API derives the same code on submit (`codeFromName` on both sides).
 */
function follow(root: HTMLElement) {
  const name = root.querySelector<HTMLInputElement>('#f-name');
  const code = root.querySelector<HTMLInputElement>('#f-code');
  if (!name || !code) return;
  let manual = code.value !== '' && code.value !== codeFromName(name.value);
  const sync = () => {
    if (!manual) code.value = codeFromName(name.value);
  };
  const own = () => {
    manual = code.value !== '';
  };
  name.addEventListener('input', sync);
  code.addEventListener('input', own);
  return {
    destroy() {
      name.removeEventListener('input', sync);
      code.removeEventListener('input', own);
    },
  };
}
</script>

<svelte:head><title>{t('tenants.add')}</title></svelte:head>

<div class="page" use:follow>
  <h1>{t('tenants.add')}</h1>
  <p class="text-sm text-muted-foreground">{t('tenants.new.lead_1')}<code>admin</code>{t('tenants.new.lead_2')}<code>user</code>{t('tenants.new.lead_3')}</p>
  <FormBuilder {fields} values={(form?.values as Record<string, unknown> | undefined) ?? {}} errors={fieldErrors} csrf={data.csrf} submitLabel={t('common.create')} cancelHref="/tenants" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
