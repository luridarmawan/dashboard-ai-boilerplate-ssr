<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import type { LayoutData } from '../../$types';
import type { ActionData } from './$types';

let { data, form }: { data: LayoutData; form: ActionData } = $props();
</script>

<svelte:head><title>Tambah grup</title></svelte:head>

<main>
  <h1>Tambah grup</h1>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <form method="POST" class="stack">
    <Csrf token={data.csrf} />
    <label>Kode <input name="code" required pattern="[a-z][a-z0-9_\-]*" minlength="2" maxlength="64" value={form?.values?.code ?? ''} /><span class="muted">huruf kecil, angka, - dan _; tetap setelah dibuat</span></label>
    <label>Nama <input name="name" required maxlength="191" value={form?.values?.name ?? ''} /></label>
    <label>Deskripsi <textarea name="description" rows="2">{form?.values?.description ?? ''}</textarea></label>
    <p class="muted">Izin dan anggota diatur setelah grup dibuat.</p>
    <div class="row"><button type="submit">Buat</button><a href="/groups">Batal</a></div>
  </form>
</main>
