<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
</script>

<svelte:head><title>Tambah pengguna</title></svelte:head>

<main>
  <h1>Tambah pengguna</h1>
  {#if form?.error}
    <p class="error">{form.error}{#if Array.isArray(form.details)} — {form.details.join(', ')}{/if}</p>
  {/if}
  <form method="POST" class="stack">
    <Csrf token={data.csrf} />
    <label>Nama <input name="name" required maxlength="191" value={form?.values?.name ?? ''} /></label>
    <label>Email <input name="email" type="email" required value={form?.values?.email ?? ''} />
      <span class="muted">Akun yang sudah ada dengan email ini akan ditambahkan ke tenant ini.</span></label>
    <label>Kata sandi <input name="password" type="password" minlength="12" autocomplete="new-password" />
      <span class="muted">Kosongkan agar pengguna mengatur sendiri lewat tautan set kata sandi.</span></label>
    <fieldset>
      <legend>Grup</legend>
      <div class="grid">
        {#each data.groups as g (g.id)}
          <label class="check"><input type="checkbox" name="groupIds" value={g.id} /> {g.name}</label>
        {/each}
      </div>
    </fieldset>
    <div class="row"><button type="submit">Simpan</button><a href="/users">Batal</a></div>
  </form>
</main>
