<script lang="ts">
import { Button } from '$lib/components/ui';
</script>

<svelte:head><title>Contoh · Galat</title></svelte:head>

<div class="page">
  <h1>Halaman galat</h1>
  <p class="text-muted-foreground">Setiap tautan melempar status dari <code>load</code>; SvelteKit merender <code>+error.svelte</code> terdekat — di dalam shell, dengan menu tetap ada.</p>
  <div class="flex gap-2">
    <Button href="?code=404" variant="outline">404</Button>
    <Button href="?code=403" variant="outline">403</Button>
    <Button href="?code=500" variant="outline">500</Button>
  </div>
</div>
