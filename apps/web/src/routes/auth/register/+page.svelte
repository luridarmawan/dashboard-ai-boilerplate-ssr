<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Daftar</title></svelte:head>

<main>
  <h1>Daftar</h1>
  {#if form?.error}
    <p class="error">{form.error}{#if Array.isArray(form.details)} — {form.details.join(', ')}{/if}</p>
  {/if}
  <form method="POST" class="stack">
    <Csrf token={data.csrf} />
    <label>Nama <input name="name" required maxlength="191" value={form?.values?.name ?? ''} /></label>
    <label>Email <input name="email" type="email" required autocomplete="username" value={form?.values?.email ?? ''} /></label>
    <label>Kata sandi <input name="password" type="password" required minlength="12" autocomplete="new-password" /><span class="muted">Minimal 12 karakter.</span></label>
    <div class="row"><button type="submit">Buat akun</button><a href="/auth/login">Sudah punya akun</a></div>
  </form>
</main>
