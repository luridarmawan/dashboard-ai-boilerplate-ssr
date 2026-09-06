<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Lupa kata sandi</title></svelte:head>

<main>
  <h1>Lupa kata sandi</h1>
  {#if form?.sent}
    <p class="notice">Jika email itu terdaftar, tautan reset telah dikirim. Periksa kotak masuk Anda.</p>
  {:else}
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    <form method="POST" class="stack">
      <Csrf token={data.csrf} />
      <label>Email <input name="email" type="email" required value={form?.values?.email ?? ''} /></label>
      <div class="row"><button type="submit">Kirim tautan reset</button><a href="/auth/login">Kembali</a></div>
    </form>
  {/if}
</main>
