<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { Badge, Button, Table } from '$lib/components/ui';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
</script>

<svelte:head><title>Modul</title></svelte:head>

<div class="page">
  <h1>Modul</h1>
  <p class="text-sm text-muted-foreground">Modul nonaktif: menu, route API, widget, dan temanya hilang untuk tenant ini; tabelnya tetap ada (G-8). Berlaku seketika di semua instance.</p>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <Table caption="Modul terpasang">
    <thead><tr><th>Modul</th><th>Versi</th><th>Sumber</th><th>Global</th><th>Tenant ini</th><th>Efektif</th>{#if can('module.manage')}<th>Aksi</th>{/if}</tr></thead>
    <tbody>
      {#each data.modules as m (m.name)}
        <tr>
          <td class="font-medium">{m.name} <code>{m.ns}</code></td>
          <td>{m.version}</td>
          <td class="text-muted-foreground">{m.source}</td>
          <td><Badge variant={m.globalEnabled ? 'success' : 'secondary'}>{m.globalEnabled ? 'aktif' : 'nonaktif'}</Badge></td>
          <td>{#if m.tenantEnabled === null}<span class="text-muted-foreground">ikuti global</span>{:else}<Badge variant={m.tenantEnabled ? 'success' : 'secondary'}>{m.tenantEnabled ? 'aktif' : 'nonaktif'}</Badge>{/if}</td>
          <td><Badge variant={m.effective ? 'success' : 'destructive'}>{m.effective ? 'aktif' : 'nonaktif'}</Badge></td>
          {#if can('module.manage')}
            <td class="whitespace-nowrap">
              <form method="POST" action="?/toggle" class="flex flex-wrap gap-1">
                <Csrf token={data.csrf} />
                <input type="hidden" name="module" value={m.name} />
                <input type="hidden" name="scope" value="tenant" />
                <Button type="submit" name="state" value={m.effective ? 'off' : 'on'} size="sm" variant={m.effective ? 'destructive' : 'default'}>{m.effective ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                {#if m.tenantEnabled !== null}<Button type="submit" name="state" value="inherit" size="sm" variant="outline">Ikuti global</Button>{/if}
              </form>
              {#if data.canGlobal}
                <form method="POST" action="?/toggle" class="mt-1 flex gap-1">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="module" value={m.name} />
                  <input type="hidden" name="scope" value="global" />
                  <Button type="submit" name="state" value={m.globalEnabled ? 'off' : 'on'} size="sm" variant="ghost">{m.globalEnabled ? 'Nonaktifkan global' : 'Aktifkan global'}</Button>
                </form>
              {/if}
            </td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </Table>
</div>
