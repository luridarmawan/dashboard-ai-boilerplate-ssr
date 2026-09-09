<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { type FieldDef, FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Alert, Badge, Button, Card, Field, Input } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const c = $derived(data.client);
const fields: FieldDef[] = [
  { name: 'name', type: 'string', label: t('tenants.name'), required: true, maxlength: 191 },
  { name: 'active', type: 'boolean', label: t('tenants.detail.active') },
];
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('tenants.detail.title', { name: c.name })}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3"><h1>{c.name}</h1><code>{c.code}</code><Badge variant={c.statusId === 1 ? 'success' : 'secondary'}>{c.statusId === 1 ? t('common.active') : t('common.inactive')}</Badge></div>
  <Card>
    <FormBuilder {fields} values={{ name: c.name, active: c.statusId === 1 }} errors={fieldErrors} csrf={data.csrf} action="?/save" readonly={!can('client.edit')} cancelHref="/tenants" cancelLabel={t('common.back')} notice={form?.saved ? t('common.saved') : null} error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
  </Card>
  {#if can('client.manage') && c.code !== 'default'}
    <Card title={t('tenants.detail.delete')} description={t('tenants.detail.delete_hint')}>
      {#if data.confirmDelete}
        <!-- Two-step confirmation (no JavaScript required): the code has to be typed, and the action checks it again. -->
        <div class="grid gap-4" id="delete">
          <Alert variant="error" title={t('tenants.detail.delete_confirm')}>
            <p>{t('tenants.detail.delete_confirm_lead', { name: c.name })}</p>
          </Alert>
          <form method="POST" action="?/delete" class="grid gap-4">
            <Csrf token={data.csrf} />
            <Field label={t('tenants.detail.delete_confirm_code', { code: c.code })} for="confirm-code" error={form?.code === 'confirm_failed' ? form.error : null} required>
              <Input id="confirm-code" name="code" autocomplete="off" autocapitalize="none" spellcheck={false} required />
            </Field>
            <div class="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive"><Icon name="trash" size={16} />{t('tenants.detail.delete_confirm_submit')}</Button>
              <Button href="/tenants/{c.id}" variant="secondary">{t('common.cancel')}</Button>
            </div>
          </form>
        </div>
      {:else}
        <Button href="/tenants/{c.id}?confirm=delete#delete" variant="destructive"><Icon name="trash" size={16} />{t('tenants.detail.delete')}</Button>
      {/if}
    </Card>
  {/if}
</div>
