<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import type { LayoutData } from '../../$types';
import type { ActionData } from './$types';

let { data, form }: { data: LayoutData; form: ActionData } = $props();
</script>

<svelte:head><title>Tambah tenant</title></svelte:head>

<main>
  <h1>Tambah tenant</h1>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <form method="POST" class="stack">
    <Csrf token={data.csrf} />
    <label>Kode <input name="code" required pattern="[a-z][a-z0-9_\-]*" minlength="2" maxlength="32" value={form?.values?.code ?? ''} /></label>
    <label>Nama <input name="name" required maxlength="191" value={form?.values?.name ?? ''} /></label>
    <p class="muted">Tenant baru langsung punya grup <code>admin</code> dan <code>user</code>; Anda menjadi anggota dan admin pertamanya.</p>
    <div class="row"><button type="submit">Buat</button><a href="/tenants">Batal</a></div>
  </form>
</main>
