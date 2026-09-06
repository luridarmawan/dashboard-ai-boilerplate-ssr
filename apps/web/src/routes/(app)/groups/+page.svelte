<script lang="ts">
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
</script>

<svelte:head><title>Grup &amp; izin</title></svelte:head>

<main>
  <div class="row" style="justify-content: space-between">
    <h1>Grup &amp; izin</h1>
    {#if can('group.create')}<a class="btn" href="/groups/new">Tambah grup</a>{/if}
  </div>
  <table>
    <thead><tr><th>Grup</th><th>Kode</th><th>Izin</th><th>Anggota</th><th></th></tr></thead>
    <tbody>
      {#each data.groups as g (g.id)}
        <tr>
          <td>{g.name}{#if g.isSystem} <code>sistem</code>{/if}</td>
          <td><code>{g.code}</code></td>
          <td>{g.permissionCount}</td>
          <td>{g.memberCount}</td>
          <td><a href={`/groups/${g.id}`}>{can('group.edit') ? 'Kelola' : 'Lihat'}</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
</main>
