<script lang="ts">
import { dropdown } from '$lib/actions/dropdown';
import Icon from '$lib/components/Icon.svelte';
import type { DashboardRegions } from '$lib/layouts/types';

/** `centered-narrow` — one narrow column for wizards and long forms; nav tucked behind a menu button. */
let { brand, nav, header, breadcrumb, content, aside, footer }: DashboardRegions = $props();
</script>

<div class="flex min-h-dvh flex-col">
  <header class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
    <details class="relative" use:dropdown>
      <summary class="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent" aria-label="Buka menu">
        <Icon name="menu" />
      </summary>
      <nav class="absolute start-0 top-11 z-40 w-64 rounded-md border bg-popover p-3 shadow-lg" aria-label="Navigasi utama">
        {@render nav({ orientation: 'vertical' })}
      </nav>
    </details>
    {@render brand()}
    <div class="ms-auto flex items-center gap-2">{@render header()}</div>
  </header>
  <div class="mx-auto w-full max-w-2xl px-4">
    <div class="pt-3 text-sm text-muted-foreground">{@render breadcrumb()}</div>
    <main id="content" class="pb-8 pt-2">{@render content()}</main>
    {#if aside}<aside class="pb-8">{@render aside()}</aside>{/if}
  </div>
  <footer class="mt-auto border-t px-4 py-3 text-center text-xs text-muted-foreground">{@render footer()}</footer>
</div>
