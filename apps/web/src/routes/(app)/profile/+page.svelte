<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import type { LayoutData } from '../$types';
import type { ActionData } from './$types';

let { data, form }: { data: LayoutData; form: ActionData } = $props();
</script>

<svelte:head><title>Profil</title></svelte:head>

<main>
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
    <label>Tema <input name="theme" value={data.user.theme ?? ''} placeholder="baku sistem" /><span class="muted">Pemilih tema visual hadir di M2 (L-12).</span></label>
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
</main>
