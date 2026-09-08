<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { type FieldDef, FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const dateLocale = useLocale() === 'en' ? 'en-US' : 'id-ID';
const can = (p: string) => data.viewer.isSuperadmin || hasPermission(data.permissions, p);
const u = $derived(data.user);
const editable = $derived(can('user.edit'));
const fields: FieldDef[] = $derived([
  { name: 'name', type: 'string', label: t('users.name'), required: true, maxlength: 191 },
  {
    name: 'locale',
    type: 'select',
    label: t('nav.language'),
    options: [
      { value: 'id', label: t('lang.id') },
      { value: 'en', label: t('lang.en') },
    ],
  },
  { name: 'active', type: 'boolean', label: t('users.detail.active') },
  ...(data.viewer.isSuperadmin
    ? [
        {
          name: 'isSuperadmin',
          type: 'boolean',
          label: t('users.detail.superadmin_label'),
        } as FieldDef,
      ]
    : []),
  {
    name: 'groupIds',
    type: 'multiselect',
    label: t('users.detail.groups_here'),
    span: 2,
    options: data.groups.map((g) => ({ value: g.id, label: g.name })),
  },
]);
const values = $derived({
  name: u.name,
  locale: u.locale,
  active: u.statusId === 1,
  isSuperadmin: u.isSuperadmin,
  groupIds: u.groups.map((g) => g.id),
});
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{u.name}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3">
    <h1>{u.name}</h1>
    <span class="text-muted-foreground">{u.email}</span>
    {#if u.isSuperadmin}<Badge variant="outline">superadmin</Badge>{/if}
    <Badge variant={u.statusId === 1 ? 'success' : 'secondary'}>{u.statusId === 1 ? t('common.active') : t('common.inactive')}</Badge>
  </div>
  {#if data.created}<p class="notice">{t('users.detail.created')}</p>{/if}
  {#if data.viewer.isSuperadmin && !data.impersonator && !u.isSuperadmin && u.id !== data.viewer.id && u.statusId === 1}
    <!-- Impersonation (D-6): one click, then the banner on every page and a way back. -->
    <form method="POST" action="?/impersonate" class="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm" data-testid="impersonate-form">
      <Csrf token={data.csrf} />
      <Icon name="eye" size={16} />
      <span>{t('users.detail.impersonate_hint')}</span>
      <Button type="submit" variant="outline" size="sm">{t('users.detail.impersonate', { name: u.name })}</Button>
    </form>
  {/if}

  <Card>
    <FormBuilder
      {fields}
      {values}
      errors={fieldErrors}
      csrf={data.csrf}
      action="?/save"
      columns={2}
      readonly={!editable}
      cancelHref="/users"
      cancelLabel={t('common.back')}
      notice={form?.saved ? t('common.saved') : null}
      error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null}
    />
    <p class="mt-4 text-sm text-muted-foreground">{t('users.detail.meta', { created: new Date(u.createdAt).toLocaleString(dateLocale), lastLogin: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString(dateLocale) : '—' })}</p>
  </Card>

  {#if can('user.manage')}
    <Card title={t('users.detail.remove_title')} description={t('users.detail.remove_desc')}>
      <form method="POST" action="?/delete">
        <Csrf token={data.csrf} />
        <Button type="submit" variant="destructive"><Icon name="trash" size={16} />{t('users.detail.remove_button')}</Button>
      </form>
    </Card>
  {/if}
</div>
