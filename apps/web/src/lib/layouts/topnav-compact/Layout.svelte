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
      <details class="relative shrink-0 md:hidden" use:dropdown>
        <summary class="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent" aria-label="Buka menu">
          <Icon name="menu" />
        </summary>
        <nav class="absolute start-0 top-11 z-40 w-64 rounded-md border bg-popover p-3 shadow-lg" aria-label="Navigasi utama">
          {@render nav({ orientation: 'vertical' })}
        </nav>
      </details>
      <!-- Brand and account region keep their natural width (`shrink-0`): only the nav gives way,
           so a long menu can never wrap the brand onto two lines nor push the account menu out. -->
      <div class="shrink-0 whitespace-nowrap">{@render brand()}</div>
      <nav id="corporate-menu" class="hidden min-w-0 flex-1 whitespace-nowrap md:ms-1 md:block" aria-label="Navigasi utama">{@render nav({ orientation: 'horizontal' })}</nav>
      <div id="nav-top-right-user-compact" class="ms-auto flex shrink-0 items-center gap-2">{@render header()}</div>
    </div>
  </header>

  <div class="px-4 pt-3 text-sm text-muted-foreground">{@render breadcrumb()}</div>
  <div class="flex flex-1 gap-6 px-4 pb-8 pt-2 {aside ? 'xl:grid xl:grid-cols-[1fr_20rem]' : ''}">
    <main id="content" class="min-w-0 flex-1">{@render content()}</main>
    {#if aside}<aside>{@render aside()}</aside>{/if}
  </div>
  <footer class="border-t px-4 py-3 text-xs text-muted-foreground">{@render footer()}</footer>
</div>

<style>
  /*
   * The whole menu shares one 48px row with the brand and the account menu, so it must never wrap:
   * it keeps its natural width and scrolls sideways when it is longer than the header. The selectors
   * are `:global` because the <ul> and the group <details> come from the shell's `nav` snippet, not
   * from this file — `#corporate-menu` is unique to this layout, so they reach nothing else.
   * Logical properties only (K-9).
   */
  :global(#corporate-menu) {
    overflow-x: auto;
    /* Thin, in the theme's own border colour: a full-size bar would sit on top of the labels. */
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  :global(#corporate-menu > ul) {
    width: max-content;
  }
  /*
   * A sideways scroll container clips vertically too, which would cut off the group dropdowns.
   * While one is open the box therefore grows down to the bottom of the viewport — no further, or
   * the overflow would give the *page* a scrollbar — and the negative margin keeps that growth out
   * of the layout. The panel stays anchored under its own summary and the sideways scroll position
   * survives opening it. The grown, empty part lets clicks through to the page under the header,
   * and the scrollbar is only made invisible (not removed) so the row does not shift by its height.
   */
  :global(#corporate-menu:has(details[open])) {
    padding-block-end: calc(100dvh - 3rem);
    margin-block-end: calc(3rem - 100dvh);
    pointer-events: none;
    scrollbar-color: transparent transparent;
  }
  :global(#corporate-menu:has(details[open]) > ul) {
    pointer-events: auto;
  }
</style>
