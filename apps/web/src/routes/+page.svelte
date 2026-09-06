<script lang="ts">
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Dashboard AI Boilerplate</title>
</svelte:head>

<main>
  <h1>Dashboard AI Boilerplate</h1>
  {#if data.api}
    <p data-testid="api-status">
      API <code>{data.api.name}@{data.api.version}</code> · dialect <code>{data.api.dialect}</code>
      · modul: {data.api.modules.map((m) => `${m.name}@${m.version}`).join(', ') || '—'}
    </p>
  {:else}
    <p data-testid="api-status">API tidak terjangkau ({data.apiError ?? 'tanpa respons'})</p>
  {/if}
  <p><small>request {data.requestId}</small></p>
</main>
