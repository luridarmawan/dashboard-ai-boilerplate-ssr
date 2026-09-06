<script lang="ts">
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
</script>

<svelte:head><title>Tenant</title></svelte:head>

<div class="page">
  <div class="row" style="justify-content: space-between">
    <h1>Tenant</h1>
    {#if can('client.create')}<a class="btn" href="/tenants/new">Tambah tenant</a>{/if}
  </div>
  <table>
    <thead><tr><th>Nama</th><th>Kode</th><th>Status</th><th>Dibuat</th><th></th></tr></thead>
    <tbody>
      {#each data.clients as c (c.id)}
        <tr>
          <td>{c.name}{#if c.id === data.clientId} <code>aktif</code>{/if}</td>
          <td><code>{c.code}</code></td>
          <td>{c.statusId === 1 ? 'aktif' : 'nonaktif'}</td>
          <td class="muted">{new Date(c.createdAt).toLocaleDateString('id-ID')}</td>
          <td><a href={`/tenants/${c.id}`}>{can('client.edit') ? 'Ubah' : 'Lihat'}</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
