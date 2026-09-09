<script lang="ts">
import { dropdown } from '$lib/actions/dropdown';
import Icon from '$lib/components/Icon.svelte';
import type { DashboardRegions } from '$lib/layouts/types';

/** `topnav-compact` — horizontal nav in the header, no sidebar, full-width content (dense tables). */
let { brand, nav, header, breadcrumb, content, aside, footer }: DashboardRegions = $props();
</script>

<div class="flex min-h-dvh flex-col">
  <header class="sticky top-0 z-30 border-b bg-card">
    <div class="flex h-12 items-center gap-3 px-4">
      <!-- Under md the top nav collapses into a menu button; it sits BEFORE the brand (start side). -->
      <details class="relative md:hidden" use:dropdown>
        <summary class="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent" aria-label="Buka menu">
          <Icon name="menu" />
        </summary>
        <nav class="absolute start-0 top-11 z-40 w-64 rounded-md border bg-popover p-3 shadow-lg" aria-label="Navigasi utama">
          {@render nav({ orientation: 'vertical' })}
        </nav>
      </details>
      {@render brand()}
      <nav class="hidden md:ms-1 md:block" aria-label="Navigasi utama">{@render nav({ orientation: 'horizontal' })}</nav>
      <div id="nav-top-right-user-compact" class="ms-auto flex items-center gap-2">{@render header()}</div>
    </div>
  </header>

  <div class="px-4 pt-3 text-sm text-muted-foreground">{@render breadcrumb()}</div>
  <div class="flex flex-1 gap-6 px-4 pb-8 pt-2 {aside ? 'xl:grid xl:grid-cols-[1fr_20rem]' : ''}">
    <main id="content" class="min-w-0 flex-1">{@render content()}</main>
    {#if aside}<aside>{@render aside()}</aside>{/if}
  </div>
  <footer class="border-t px-4 py-3 text-xs text-muted-foreground">{@render footer()}</footer>
</div>
