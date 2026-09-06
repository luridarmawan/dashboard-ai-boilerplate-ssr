<script lang="ts">
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
</script>

<svelte:head><title>Pengguna</title></svelte:head>

<div class="page">
  <div class="row" style="justify-content: space-between">
    <h1>Pengguna</h1>
    {#if can('user.create')}<a class="btn" href="/users/new">Tambah pengguna</a>{/if}
  </div>
  <form method="GET" class="row">
    <input name="q" placeholder="Cari nama / email" value={data.q} />
    <button type="submit" class="secondary">Cari</button>
  </form>
  <table>
    <thead><tr><th>Nama</th><th>Email</th><th>Grup</th><th>Status</th><th></th></tr></thead>
    <tbody>
      {#each data.users as u (u.id)}
        <tr>
          <td>{u.name}{#if u.isSuperadmin} <code>superadmin</code>{/if}</td>
          <td>{u.email}</td>
          <td>{u.groups.map((g) => g.name).join(', ') || '—'}</td>
          <td>{u.statusId === 1 ? 'aktif' : 'nonaktif'}</td>
          <td><a href={`/users/${u.id}`}>{can('user.edit') ? 'Ubah' : 'Lihat'}</a></td>
        </tr>
      {:else}
        <tr><td colspan="5" class="muted">Tidak ada pengguna.</td></tr>
      {/each}
    </tbody>
  </table>
  <p class="row muted">
    {data.meta.total} pengguna · halaman {data.meta.page}/{data.meta.totalPages}
    {#if data.meta.page > 1}<a href={`?q=${encodeURIComponent(data.q)}&page=${data.meta.page - 1}`}>‹ sebelumnya</a>{/if}
    {#if data.meta.page < data.meta.totalPages}<a href={`?q=${encodeURIComponent(data.q)}&page=${data.meta.page + 1}`}>berikutnya ›</a>{/if}
  </p>
</div>
