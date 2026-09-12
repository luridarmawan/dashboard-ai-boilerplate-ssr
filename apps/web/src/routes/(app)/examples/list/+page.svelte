<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { type ColumnDef, DataTable } from '$lib/components/table';
import { Badge, Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
type Row = (typeof data.rows)[number];
const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});
const columns: ColumnDef<Row>[] = [
  { key: 'name', label: t('examples.product'), sortKey: 'name', value: (r) => r.name },
  { key: 'category', label: t('examples.category'), sortKey: 'category', value: (r) => r.category },
  {
    key: 'price',
    label: t('examples.price'),
    sortKey: 'price',
    align: 'right',
    value: (r) => idr.format(r.price),
  },
  {
    key: 'stock',
    label: t('examples.stock'),
    sortKey: 'stock',
    align: 'right',
    value: (r) => r.stock,
  },
  { key: 'status', label: 'Status' },
  {
    key: 'id',
    label: 'ID',
    hidden: true,
    value: (r) => r.id.slice(-6),
    class: 'font-mono text-xs',
  },
];
</script>

<svelte:head><title>{t('examples.prefix')} · {t('examples.list.short')}</title></svelte:head>

<div class="page">
  <h1>{t('examples.list.title')}</h1>
  {#if form?.archived !== undefined}<p class="notice">{t('examples.list.archived', { n: form.archived })}</p>{/if}
  <DataTable
    rows={data.rows}
    {columns}
    state={data.state}
    csrf={data.csrf}
    caption={t('examples.list.caption')}
    searchPlaceholder={t('examples.list.search_placeholder')}
    rowActions={[
      { label: t('common.detail'), icon: 'eye', iconOnly: true, href: (r) => `/examples/detail?id=${r.id}` },
      { label: t('common.edit'), icon: 'edit', iconOnly: true, href: (r) => `/examples/form?id=${r.id}` },
    ]}
    bulkActions={[{ action: '?/archive', label: t('examples.list.archive'), icon: 'folder' }]}
  >
    {#snippet toolbar()}<Button href="/examples/form" size="sm"><Icon name="plus" size={16} />{t('examples.list.new_product')}</Button>{/snippet}
    {#snippet cell(row, col)}
      {#if col.key === 'status'}<Badge variant={row.status === 'aktif' ? 'success' : 'secondary'}>{row.status}</Badge>
      {:else if col.key === 'stock'}<span class={row.stock === 0 ? 'text-destructive' : ''}>{row.stock}</span>
      {:else}{col.value ? (col.value(row) ?? '—') : '—'}{/if}
    {/snippet}
  </DataTable>
</div>
