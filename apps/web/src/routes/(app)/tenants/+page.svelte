<script lang="ts">
import { type ColumnDef, DataTable } from '$lib/components/table';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const t = useT();
const locale = useLocale();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID');
type Row = (typeof data.clients)[number];

const columns: ColumnDef<Row>[] = [
  {
    key: 'name',
    label: t('tenants.name'),
    sortKey: 'name',
    value: (r) => r.name,
  },
  { key: 'code', label: t('tenants.code'), value: (r) => r.code },
  { key: 'status', label: t('tenants.status') },
  {
    key: 'created',
    label: t('tenants.created'),
    value: (r) => fmtDate(r.createdAt),
  },
];
</script>

<svelte:head><title>{t('nav.tenants')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('nav.tenants')}</h1>
  </div>

  <DataTable
    rows={data.clients}
    {columns}
    state={data.state}
    caption={t('tenants.caption')}
    searchPlaceholder={t('tenants.search_placeholder')}
    emptyTitle={t('tenants.empty_title')}
    emptyHint={data.state.q ? t('tenants.empty_hint_search') : t('tenants.empty_hint_add')}
    rowActions={[{ label: can('client.edit') ? t('common.edit') : t('common.view'), icon: can('client.edit') ? 'edit' : 'eye', href: (r) => `/tenants/${r.id}` }]}
  >
    {#snippet cell(row, col)}
      {#if col.key === 'name'}
        <a href={`/tenants/${row.id}`} class="font-medium text-foreground">{row.name}</a>
        {#if row.id === data.clientId} <code>{t('common.active')}</code>{/if}
      {:else if col.key === 'code'}
        <code>{row.code}</code>
      {:else if col.key === 'status'}
        {row.statusId === 1 ? t('common.active') : t('common.inactive')}
      {:else}
        {col.value ? (col.value(row) ?? '—') : '—'}
      {/if}
    {/snippet}
  </DataTable>
</div>
