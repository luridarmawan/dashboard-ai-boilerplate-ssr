<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Masuk</title></svelte:head>

<div class="page">
  <h1>Masuk</h1>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <form method="POST" class="stack">
    <Csrf token={data.csrf} />
    <input type="hidden" name="next" value={data.next} />
    <label>Email <input name="email" type="email" required autocomplete="username" value={form?.values?.email ?? ''} /></label>
    <label>Kata sandi <input name="password" type="password" required autocomplete="current-password" /></label>
    <div class="row">
      <button type="submit">Masuk</button>
      <a href="/auth/forgot">Lupa kata sandi?</a>
      <a href="/auth/register">Daftar</a>
    </div>
  </form>
</div>
