<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import type { PublicRegions } from '$lib/layouts/types';

/** `marketing-wide` — transparent header, full-bleed sections, thick footer. Public pages. */
let { brand, nav, content, footer }: PublicRegions = $props();
</script>

<div class="flex min-h-dvh flex-col">
  <header class="absolute inset-x-0 top-0 z-30">
    <div class="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
      {@render brand()}
      <nav class="ms-auto hidden md:block" aria-label="Navigasi">{@render nav({ orientation: 'horizontal' })}</nav>
      <details class="relative ms-auto md:hidden">
        <summary class="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent" aria-label="Buka menu">
          <Icon name="menu" />
        </summary>
        <nav class="absolute end-0 top-11 z-40 w-56 rounded-md border bg-popover p-3 shadow-lg" aria-label="Navigasi">
          {@render nav({ orientation: 'vertical' })}
        </nav>
      </details>
    </div>
  </header>
  <main id="content" class="flex-1 pt-16">{@render content()}</main>
  <footer class="border-t bg-card">
    <div class="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground">{@render footer()}</div>
  </footer>
</div>
