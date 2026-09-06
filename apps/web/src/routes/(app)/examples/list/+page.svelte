<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { type ColumnDef, DataTable } from '$lib/components/table';
import { Badge, Button } from '$lib/components/ui';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
type Row = (typeof data.rows)[number];
const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});
const columns: ColumnDef<Row>[] = [
  { key: 'name', label: 'Produk', sortKey: 'name', value: (r) => r.name },
  { key: 'category', label: 'Kategori', sortKey: 'category', value: (r) => r.category },
  {
    key: 'price',
    label: 'Harga',
    sortKey: 'price',
    align: 'right',
    value: (r) => idr.format(r.price),
  },
  { key: 'stock', label: 'Stok', sortKey: 'stock', align: 'right', value: (r) => r.stock },
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

<svelte:head><title>Contoh · Daftar</title></svelte:head>

<div class="page">
  <h1>Daftar CRUD</h1>
  {#if form?.archived !== undefined}<p class="notice">{form.archived} item diarsipkan (contoh — tidak ada perubahan nyata).</p>{/if}
  <DataTable
    rows={data.rows}
    {columns}
    state={data.state}
    csrf={data.csrf}
    caption="Contoh daftar produk"
    searchPlaceholder="Cari produk / kategori"
    rowActions={[
      { label: 'Detail', icon: 'eye', href: (r) => `/examples/detail?id=${r.id}` },
      { label: 'Ubah', icon: 'edit', href: (r) => `/examples/form?id=${r.id}` },
    ]}
    bulkActions={[{ action: '?/archive', label: 'Arsipkan', icon: 'folder' }]}
  >
    {#snippet toolbar()}<Button href="/examples/form" size="sm"><Icon name="plus" size={16} />Produk baru</Button>{/snippet}
    {#snippet cell(row, col)}
      {#if col.key === 'status'}<Badge variant={row.status === 'aktif' ? 'success' : 'secondary'}>{row.status}</Badge>
      {:else if col.key === 'stock'}<span class={row.stock === 0 ? 'text-destructive' : ''}>{row.stock}</span>
      {:else}{col.value ? (col.value(row) ?? '—') : '—'}{/if}
    {/snippet}
  </DataTable>
</div>
