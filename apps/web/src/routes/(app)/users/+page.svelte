<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { type ColumnDef, DataTable } from '$lib/components/table';
import { Badge, Button } from '$lib/components/ui';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
type Row = (typeof data.users)[number];

const columns: ColumnDef<Row>[] = [
  { key: 'name', label: 'Nama', sortKey: 'name', value: (r) => r.name },
  { key: 'email', label: 'Email', sortKey: 'email', value: (r) => r.email },
  { key: 'groups', label: 'Grup', value: (r) => r.groups.map((g) => g.name).join(', ') || '—' },
  { key: 'status', label: 'Status' },
  {
    key: 'lastLogin',
    label: 'Login terakhir',
    sortKey: 'last_login_at',
    hidden: true,
    value: (r) => (r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString('id-ID') : '—'),
  },
  {
    key: 'created',
    label: 'Terdaftar',
    sortKey: 'created_at',
    hidden: true,
    value: (r) => new Date(r.createdAt).toLocaleDateString('id-ID'),
  },
];
const deactivated = $derived(page.url.searchParams.get('deactivated'));
</script>

<svelte:head><title>Pengguna</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>Pengguna</h1>
  </div>
  {#if deactivated}<p class="notice">{deactivated} pengguna dinonaktifkan.</p>{/if}

  <DataTable
    rows={data.users}
    {columns}
    state={data.state}
    csrf={data.csrf}
    caption="Daftar pengguna tenant aktif"
    searchPlaceholder="Cari nama / email"
    emptyTitle="Belum ada pengguna"
    emptyHint={data.state.q ? 'Coba kata kunci lain.' : 'Tambahkan pengguna pertama Anda.'}
    rowActions={[{ label: can('user.edit') ? 'Ubah' : 'Lihat', icon: can('user.edit') ? 'edit' : 'eye', href: (r) => `/users/${r.id}` }]}
    bulkActions={can('user.edit') ? [{ action: '?/deactivate', label: 'Nonaktifkan', icon: 'lock', destructive: true }] : []}
  >
    {#snippet toolbar()}
      {#if can('user.create')}<Button href="/users/new" size="sm"><Icon name="plus" size={16} />Tambah pengguna</Button>{/if}
    {/snippet}
    {#snippet cell(row, col)}
      {#if col.key === 'status'}
        <Badge variant={row.statusId === 1 ? 'success' : 'secondary'}>{row.statusId === 1 ? 'aktif' : 'nonaktif'}</Badge>
      {:else if col.key === 'name'}
        <a href={`/users/${row.id}`} class="font-medium text-foreground">{row.name}</a>{#if row.isSuperadmin} <Badge variant="outline">superadmin</Badge>{/if}
      {:else}
        {col.value ? (col.value(row) ?? '—') : '—'}
      {/if}
    {/snippet}
  </DataTable>
</div>
