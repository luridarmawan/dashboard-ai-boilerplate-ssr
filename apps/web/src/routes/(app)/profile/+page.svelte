<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
</script>

<svelte:head><title>Profil</title></svelte:head>

<div class="page">
  <h1>Profil saya</h1>
  {#if form?.saved === 'profile'}<p class="notice">Profil tersimpan.</p>{/if}
  {#if form?.saved === 'password'}<p class="notice">Kata sandi diganti. Sesi di perangkat lain telah diakhiri.</p>{/if}
  {#if form?.error}
    <p class="error">{form.error}{#if Array.isArray(form.details)} — {form.details.join(', ')}{/if}</p>
  {/if}

  <form method="POST" action="?/profile" class="stack">
    <Csrf token={data.csrf} />
    <label>Nama <input name="name" required maxlength="191" value={data.user.name} /></label>
    <label>Email <input value={data.user.email} disabled /></label>
    <label>Bahasa
      <select name="locale">
        <option value="id" selected={data.user.locale === 'id'}>Bahasa Indonesia</option>
        <option value="en" selected={data.user.locale === 'en'}>English</option>
      </select>
    </label>
    <label>Tema
      <select name="theme">
        <option value="" selected={!data.user.theme}>Baku sistem</option>
        {#each data.themes as t (t.id)}<option value={t.id} selected={data.user.theme === t.id}>{t.name}</option>{/each}
      </select>
      <span class="muted">Pratinjau dan mode terang/gelap ada di <a href="/theme?back=/profile">Tema &amp; tampilan</a>.</span>
    </label>
    <label>URL avatar <input name="avatarUrl" type="url" value={data.user.avatarUrl ?? ''} /></label>
    <div><button type="submit">Simpan</button></div>
  </form>

  <h2>Ganti kata sandi</h2>
  <form method="POST" action="?/password" class="stack">
    <Csrf token={data.csrf} />
    <label>Kata sandi saat ini <input name="currentPassword" type="password" required autocomplete="current-password" /></label>
    <label>Kata sandi baru <input name="newPassword" type="password" required minlength="12" autocomplete="new-password" /></label>
    <label>Ulangi kata sandi baru <input name="confirm" type="password" required minlength="12" autocomplete="new-password" /></label>
    <div><button type="submit">Ganti kata sandi</button></div>
  </form>
</div>
