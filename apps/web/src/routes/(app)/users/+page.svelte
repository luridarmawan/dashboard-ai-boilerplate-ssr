<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { type ColumnDef, DataTable } from '$lib/components/table';
import { Badge, Button } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const t = useT();
const dateLocale = useLocale() === 'en' ? 'en-US' : 'id-ID';
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
type Row = (typeof data.users)[number];

const columns: ColumnDef<Row>[] = [
  { key: 'name', label: t('users.name'), sortKey: 'name', value: (r) => r.name },
  { key: 'email', label: t('users.email'), sortKey: 'email', value: (r) => r.email },
  {
    key: 'groups',
    label: t('users.groups'),
    value: (r) => r.groups.map((g) => g.name).join(', ') || '—',
  },
  { key: 'status', label: t('users.status') },
  {
    key: 'lastLogin',
    label: t('users.last_login'),
    sortKey: 'last_login_at',
    hidden: true,
    value: (r) => (r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString(dateLocale) : '—'),
  },
  {
    key: 'created',
    label: t('users.created'),
    sortKey: 'created_at',
    hidden: true,
    value: (r) => new Date(r.createdAt).toLocaleDateString(dateLocale),
  },
];
const deactivated = $derived(page.url.searchParams.get('deactivated'));
</script>

<svelte:head><title>{t('nav.users')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('nav.users')}</h1>
  </div>
  {#if deactivated}<p class="notice">{t('users.deactivated', { n: deactivated })}</p>{/if}

  <DataTable
    rows={data.users}
    {columns}
    state={data.state}
    csrf={data.csrf}
    caption={t('users.caption')}
    searchPlaceholder={t('users.search_placeholder')}
    emptyTitle={t('users.empty_title')}
    emptyHint={data.state.q ? t('users.empty_hint_search') : t('users.empty_hint_add')}
    rowActions={[{ label: can('user.edit') ? t('common.edit') : t('common.view'), icon: can('user.edit') ? 'edit' : 'eye', href: (r) => `/users/${r.id}` }]}
    bulkActions={can('user.edit') ? [{ action: '?/deactivate', label: t('users.deactivate'), icon: 'lock', destructive: true }] : []}
  >
    {#snippet toolbar()}
      {#if can('user.create')}<Button href="/users/new" size="sm"><Icon name="plus" size={16} />{t('users.add')}</Button>{/if}
    {/snippet}
    {#snippet cell(row, col)}
      {#if col.key === 'status'}
        <Badge variant={row.statusId === 1 ? 'success' : 'secondary'}>{row.statusId === 1 ? t('common.active') : t('common.inactive')}</Badge>
      {:else if col.key === 'name'}
        <a href={`/users/${row.id}`} class="font-medium text-foreground">{row.name}</a>{#if row.isSuperadmin} <Badge variant="outline">superadmin</Badge>{/if}
      {:else}
        {col.value ? (col.value(row) ?? '—') : '—'}
      {/if}
    {/snippet}
  </DataTable>
</div>
