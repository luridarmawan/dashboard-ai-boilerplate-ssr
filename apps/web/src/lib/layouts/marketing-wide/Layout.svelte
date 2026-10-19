<script lang="ts">
import { dropdown } from '$lib/actions/dropdown';
import Icon from '$lib/components/Icon.svelte';
import type { PublicRegions } from '$lib/layouts/types';

/**
 * `marketing-wide` — translucent sticky header, full-bleed sections, thick footer. Public pages.
 * The header is up to three rows and only the main row stays stuck: the top bar above it and the
 * menu bar below it scroll away with the page, so a long menu never eats the reading area. Under
 * md the nav and the menu bar fold into the menu button; the search box drops to a full-width
 * line of its own and the actions stay beside the button.
 *
 * `#topbar` and `#menubar` are styling hooks for themes and derived apps; the menu bar's copy
 * inside the mobile menu carries no id, so each id stays unique on the page.
 */
let { brand, nav, topbar, search, actions, menubar, content, footer }: PublicRegions = $props();
</script>

<div class="flex min-h-dvh flex-col">
  {#if topbar}
    <!-- No overflow on this row: it would clip the language dropdown that opens below it (the
         shell's own item list scrolls instead). z-40 lifts that dropdown over the sticky header. -->
    <div id="topbar" class="relative z-40 border-b bg-muted text-xs text-muted-foreground" data-testid="site-topbar">
      <!-- Thin on purpose: dropdown buttons in this row (the language picker) shrink to its height. -->
      <div class="mx-auto flex min-h-7 max-w-6xl items-center gap-4 px-6 [&_summary]:h-6">{@render topbar()}</div>
    </div>
  {/if}
  <header class="sticky top-0 z-30 bg-background/80 backdrop-blur">
    <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:h-16 md:flex-nowrap md:py-0">
      {@render brand()}
      {#if search}
        <!-- From md the container takes all the room between brand and nav and centres the box in it. -->
        <div id="search-container" class="order-last min-w-0 max-w-full basis-full md:order-none md:flex md:flex-1 md:basis-auto md:justify-center" data-testid="site-search">
          <div class="w-full min-w-0 md:max-w-xl">{@render search()}</div>
        </div>
      {/if}
      <nav class="hidden md:ms-auto md:block" aria-label="Navigasi">{@render nav({ orientation: 'horizontal' })}</nav>
      {#if actions}
        <div class="ms-auto flex items-center gap-1 md:ms-0" data-testid="site-actions">{@render actions()}</div>
      {/if}
      <details class={`relative md:hidden ${actions ? '' : 'ms-auto'}`} use:dropdown>
        <summary class="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent" aria-label="Buka menu">
          <Icon name="menu" />
        </summary>
        <nav class="absolute end-0 top-11 z-40 grid max-h-[calc(100dvh-5rem)] w-64 gap-3 overflow-y-auto rounded-md border bg-popover p-3 shadow-lg" aria-label="Navigasi">
          {#if menubar}
            <div class="border-b pb-3">{@render menubar({ orientation: 'vertical' })}</div>
          {/if}
          {@render nav({ orientation: 'vertical' })}
        </nav>
      </details>
    </div>
  </header>
  {#if menubar}
    <!-- Outside the sticky header on purpose; z-20 keeps its dropdowns above the page, while the
         stuck main row (z-30) still slides over it when scrolling. -->
    <div id="menubar" class="relative z-20 hidden border-t border-b bg-background md:block" data-testid="site-menubar">
      <nav class="mx-auto max-w-6xl px-2" aria-label="Menu">{@render menubar({ orientation: 'horizontal' })}</nav>
    </div>
  {/if}
  <main id="content" class="flex-1">{@render content()}</main>
  <footer class="border-t bg-card">
    <div class="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground">{@render footer()}</div>
  </footer>
</div>
