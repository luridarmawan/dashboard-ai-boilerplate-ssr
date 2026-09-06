<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Atur kata sandi baru</title></svelte:head>

<main>
  <h1>Atur kata sandi baru</h1>
  {#if !data.valid}
    <p class="error">Tautan tidak valid atau sudah kedaluwarsa. <a href="/auth/forgot">Minta tautan baru</a>.</p>
  {:else}
    {#if form?.error}
      <p class="error">{form.error}{#if Array.isArray(form.details)} — {form.details.join(', ')}{/if}</p>
    {/if}
    <form method="POST" class="stack">
      <Csrf token={data.csrf} />
      <input type="hidden" name="token" value={data.token} />
      <label>Kata sandi baru <input name="password" type="password" required minlength="12" autocomplete="new-password" /></label>
      <button type="submit">Simpan</button>
    </form>
  {/if}
</main>
