<script lang="ts">
import type { Snippet } from 'svelte';

/**
 * `dummy.two-column` — a layout contributed by a module. It only ARRANGES the regions core hands
 * it (§4.8): a slim icon rail on the left, header on top, content in a two-column grid. It does
 * not fetch, and it knows no module names — not even its own.
 */
type Nav = Snippet<[{ orientation: 'vertical' | 'horizontal' }]>;
let {
  brand,
  nav,
  header,
  breadcrumb,
  content,
  aside,
  footer,
}: {
  brand: Snippet;
  nav: Nav;
  header: Snippet;
  breadcrumb: Snippet;
  content: Snippet;
  aside?: Snippet;
  footer: Snippet;
} = $props();
</script>

<div class="min-h-dvh md:grid md:grid-cols-[13rem_1fr]" data-layout="dummy.two-column">
  <aside class="border-r bg-muted/40 p-3 md:sticky md:top-0 md:h-dvh md:overflow-y-auto">
    <div class="mb-4">{@render brand()}</div>
    <nav aria-label="Navigasi utama">{@render nav({ orientation: 'vertical' })}</nav>
  </aside>
  <div class="flex min-w-0 flex-col">
    <header class="flex h-14 items-center justify-end gap-2 border-b px-4">{@render header()}</header>
    <div class="px-4 pt-3 text-sm text-muted-foreground">{@render breadcrumb()}</div>
    <div class="grid flex-1 gap-6 px-4 pb-8 pt-2 lg:grid-cols-[2fr_1fr]">
      <main id="content" class="min-w-0">{@render content()}</main>
      <aside class="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {#if aside}{@render aside()}{:else}Kolom kedua layout <code>dummy.two-column</code> — disumbang modul Dummy.{/if}
      </aside>
    </div>
    <footer class="border-t px-4 py-3 text-xs text-muted-foreground">{@render footer()}</footer>
  </div>
</div>
