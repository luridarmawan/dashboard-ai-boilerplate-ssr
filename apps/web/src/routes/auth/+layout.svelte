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
{#snippet content()}{@render children()}{/snippet}
{#snippet footer()}
  <span>© Dashboard AI Boilerplate · <a href="/theme">Tema</a></span>
{/snippet}

<Layout {brand} {content} {footer} />
