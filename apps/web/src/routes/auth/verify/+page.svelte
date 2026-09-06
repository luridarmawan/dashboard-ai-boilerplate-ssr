<script lang="ts">
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Verifikasi email</title></svelte:head>

<div class="page">
  <h1>Verifikasi email</h1>
  <p class={data.verified ? 'notice' : 'error'}>{data.message}</p>
  <p><a href="/dashboard">Ke dasbor</a></p>
</div>
