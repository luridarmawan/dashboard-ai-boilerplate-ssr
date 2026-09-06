<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import type { LayoutData } from './$types';

let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
const Layout = $derived(data.Layout);
</script>

{#snippet brand()}
  <a href="/" class="flex items-center gap-2 text-lg font-semibold text-foreground no-underline hover:no-underline">
    <Icon name="sparkles" class="text-primary" /><span>Dashboard</span>
  </a>
{/snippet}
{#snippet nav({ orientation }: { orientation: 'vertical' | 'horizontal' })}
  <ul class={orientation === 'horizontal' ? 'flex items-center gap-4 text-sm' : 'grid gap-1 text-sm'}>
    <li><a href="/theme" class="text-foreground no-underline hover:underline">Tema</a></li>
    {#if data.loggedIn}
      <li><a href="/dashboard" class="text-foreground no-underline hover:underline">Dasbor</a></li>
    {:else}
      <li><a href="/auth/login" class="text-foreground no-underline hover:underline">Masuk</a></li>
      <li><a href="/auth/register" class="text-foreground no-underline hover:underline">Daftar</a></li>
    {/if}
  </ul>
{/snippet}
{#snippet content()}{@render children()}{/snippet}
{#snippet footer()}
  <p>Dashboard AI Boilerplate — API-first, multi-tenant, bertema. Halaman landing dari modul Example hadir di M4.</p>
{/snippet}

<Layout {brand} {nav} {content} {footer} />
