<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const g = $derived(data.group);
const granted = $derived(new Set(g.permissions.map((p) => p.permission)));
// Anything not representable as a matrix cell (wildcards, unknown-to-registry leftovers).
const matrixKeys = $derived(
  new Set(data.registry.flatMap((r) => r.actions.map((a) => `${r.resource}.${a}`))),
);
const extras = $derived([...granted].filter((p) => !matrixKeys.has(p)));
const memberIds = $derived(new Set(g.members.map((m) => m.userId)));
const candidates = $derived(data.tenantUsers.filter((u) => !memberIds.has(u.id)));
const editable = $derived(can('group.edit'));
</script>

<svelte:head><title>Grup {g.name}</title></svelte:head>

<main>
  <h1>{g.name} <code>{g.code}</code>{#if g.isSystem} <span class="muted">grup sistem</span>{/if}</h1>
  {#if form?.saved}<p class="notice">Tersimpan — perubahan langsung berlaku untuk semua anggota.</p>{/if}
  {#if form?.error}
    <p class="error">{form.error}{#if form.details && typeof form.details === 'object' && 'unknown' in form.details} — {(form.details as { unknown: string[] }).unknown.join(', ')}{/if}</p>
  {/if}

  <form method="POST" action="?/save" class="stack">
    <Csrf token={data.csrf} />
    <label>Nama <input name="name" required maxlength="191" value={g.name} disabled={!editable} /></label>
    <label>Deskripsi <textarea name="description" rows="2" disabled={!editable}>{g.description ?? ''}</textarea></label>
    {#if editable}<div><button type="submit">Simpan</button></div>{/if}
  </form>

  <h2>Izin</h2>
  <form method="POST" action="?/permissions" class="stack" style="max-width: none">
    <Csrf token={data.csrf} />
    <table>
      <thead><tr><th>Resource</th><th>Modul</th><th>Aksi</th></tr></thead>
      <tbody>
        {#each data.registry as r (r.resource)}
          <tr>
            <td>{r.name.id} <code>{r.resource}</code></td>
            <td class="muted">{r.module}</td>
            <td class="row">
              {#each r.actions as a (a)}
                <label class="check"><input type="checkbox" name="perm" value={`${r.resource}.${a}`} checked={granted.has(`${r.resource}.${a}`)} disabled={!editable} /> {a}</label>
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <label>Wildcard &amp; tambahan (dipisah spasi/koma) — mis. <code>*.*</code>, <code>user.*</code>, <code>*.read</code>
      <input name="extra" value={extras.join(' ')} disabled={!editable} /></label>
    {#if editable}<div><button type="submit">Simpan izin</button></div>{/if}
  </form>

  <h2>Anggota ({g.members.length})</h2>
  <table>
    <thead><tr><th>Nama</th><th>Email</th><th></th></tr></thead>
    <tbody>
      {#each g.members as m (m.id)}
        <tr>
          <td>{m.name}</td><td>{m.email}</td>
          <td>
            {#if editable}
              <form method="POST" action="?/removeMember" class="row">
                <Csrf token={data.csrf} />
                <input type="hidden" name="userId" value={m.userId} />
                <button type="submit" class="secondary">Keluarkan</button>
              </form>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="3" class="muted">Belum ada anggota.</td></tr>
      {/each}
    </tbody>
  </table>
  {#if editable && candidates.length}
    <form method="POST" action="?/addMember" class="row" style="margin-top:.75rem">
      <Csrf token={data.csrf} />
      <select name="userId">
        {#each candidates as u (u.id)}<option value={u.id}>{u.name} — {u.email}</option>{/each}
      </select>
      <button type="submit">Tambah anggota</button>
    </form>
  {/if}

  {#if can('group.manage') && !g.isSystem}
    <h2>Hapus grup</h2>
    <form method="POST" action="?/delete" class="row">
      <Csrf token={data.csrf} />
      <button type="submit" class="danger">Hapus grup</button>
      <span class="muted">Anggota kehilangan izin grup ini seketika.</span>
    </form>
  {/if}
  <p><a href="/groups">← Semua grup</a></p>
</main>
