<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const c = $derived(data.client);
</script>

<svelte:head><title>Tenant {c.name}</title></svelte:head>

<div class="page">
  <h1>{c.name} <code>{c.code}</code></h1>
  {#if form?.saved}<p class="notice">Tersimpan.</p>{/if}
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <form method="POST" action="?/save" class="stack">
    <Csrf token={data.csrf} />
    <label>Nama <input name="name" required maxlength="191" value={c.name} disabled={!can('client.edit')} /></label>
    <label class="check"><input type="checkbox" name="active" checked={c.statusId === 1} disabled={!can('client.edit')} /> Aktif</label>
    <div class="row">
      {#if can('client.edit')}<button type="submit">Simpan</button>{/if}
      <a href="/tenants">Kembali</a>
    </div>
  </form>
  {#if can('client.manage') && c.code !== 'default'}
    <h2>Hapus tenant</h2>
    <form method="POST" action="?/delete" class="row">
      <Csrf token={data.csrf} />
      <button type="submit" class="danger">Hapus tenant</button>
      <span class="muted">Hapus lunak; sesi yang sedang berada di tenant ini kembali ke "tanpa tenant".</span>
    </form>
  {/if}
</div>
