<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const u = $derived(data.user);
const member = $derived(new Set(u.groups.map((g) => g.id)));
</script>

<svelte:head><title>{u.name}</title></svelte:head>

<main>
  <h1>{u.name} <span class="muted">{u.email}</span></h1>
  {#if data.created}<p class="notice">Pengguna dibuat.</p>{/if}
  {#if form?.saved}<p class="notice">Tersimpan.</p>{/if}
  {#if form?.error}<p class="error">{form.error}</p>{/if}

  <form method="POST" action="?/save" class="stack">
    <Csrf token={data.csrf} />
    <label>Nama <input name="name" required maxlength="191" value={u.name} disabled={!can('user.edit')} /></label>
    <label class="check"><input type="checkbox" name="active" checked={u.statusId === 1} disabled={!can('user.edit')} /> Aktif</label>
    {#if data.user.isSuperadmin}
      <label class="check"><input type="checkbox" name="isSuperadmin" checked={u.isSuperadmin} /> Superadmin (berlaku di semua tenant)</label>
    {/if}
    <fieldset>
      <legend>Grup di tenant ini</legend>
      <div class="grid">
        {#each data.groups as g (g.id)}
          <label class="check"><input type="checkbox" name="groupIds" value={g.id} checked={member.has(g.id)} disabled={!can('user.edit')} /> {g.name}</label>
        {/each}
      </div>
    </fieldset>
    <p class="muted">Terdaftar {new Date(u.createdAt).toLocaleString('id-ID')} · login terakhir {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('id-ID') : '—'}</p>
    <div class="row">
      {#if can('user.edit')}<button type="submit">Simpan</button>{/if}
      <a href="/users">Kembali</a>
    </div>
  </form>

  {#if can('user.manage')}
    <h2>Hapus dari tenant</h2>
    <form method="POST" action="?/delete" class="row">
      <Csrf token={data.csrf} />
      <button type="submit" class="danger">Hapus pengguna dari tenant ini</button>
      <span class="muted">Akun ikut dihapus (lunak) bila ini tenant terakhirnya.</span>
    </form>
  {/if}
</main>
