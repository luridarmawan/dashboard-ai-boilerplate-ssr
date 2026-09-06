<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import type { DashboardRegions } from '$lib/layouts/types';

/** `sidebar-classic` — left sidebar (nav) + header; nav collapses into <details> under md (no JS needed). */
let { brand, nav, header, breadcrumb, content, aside, footer }: DashboardRegions = $props();
</script>

<div class="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
  <aside class="hidden border-r bg-card md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
    <div class="flex h-14 items-center border-b px-4">{@render brand()}</div>
    <nav class="flex-1 overflow-y-auto p-3" aria-label="Navigasi utama">{@render nav({ orientation: 'vertical' })}</nav>
  </aside>

  <div class="flex min-w-0 flex-col">
    <header class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      <details class="relative md:hidden">
        <summary class="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent" aria-label="Buka menu">
          <Icon name="menu" />
        </summary>
        <nav class="absolute left-0 top-11 z-40 w-64 rounded-md border bg-popover p-3 shadow-lg" aria-label="Navigasi utama">
          {@render nav({ orientation: 'vertical' })}
        </nav>
      </details>
      <div class="md:hidden">{@render brand()}</div>
      <div class="ml-auto flex items-center gap-2">{@render header()}</div>
    </header>

    <div class="px-4 pt-3 text-sm text-muted-foreground">{@render breadcrumb()}</div>

    <div class="flex flex-1 gap-6 px-4 pb-8 pt-2 {aside ? 'lg:grid lg:grid-cols-[1fr_18rem]' : ''}">
      <main id="content" class="min-w-0 flex-1">{@render content()}</main>
      {#if aside}<aside class="mt-6 lg:mt-0">{@render aside()}</aside>{/if}
    </div>

    <footer class="border-t px-4 py-3 text-xs text-muted-foreground">{@render footer()}</footer>
  </div>
</div>
