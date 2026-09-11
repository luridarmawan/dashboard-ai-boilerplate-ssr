<script lang="ts">
import type { Snippet } from 'svelte';
import { dropdown } from '$lib/actions/dropdown';
import { railExpand } from '$lib/actions/rail';
import Icon from '$lib/components/Icon.svelte';
import SidebarToggle from '$lib/components/SidebarToggle.svelte';

/**
 * `dummy.two-column` — a layout contributed by a module. It only ARRANGES the regions core hands
 * it (§4.8): a slim icon rail on the left, header on top, content beside an optional second
 * column. It does not fetch, and it knows no module names — not even its own.
 *
 * `aside` is OPTIONAL and no dashboard page fills it today, so the second column is rendered
 * only when one is handed over — exactly like the core layouts. It used to render regardless,
 * with placeholder text naming this module, which squeezed every page to two thirds of the
 * width for a column that held nothing: a layout must not invent content it was not given.
 *
 * Under `md` the rail would stack ABOVE the header and push it off screen, so it is hidden there
 * and the nav moves into a menu button inside the header — which stays stuck to the top on every
 * screen size.
 *
 * It owns a rail, so it also offers the collapse toggle (F-8): a module layout does this with the
 * same two moves a core one makes — render `<SidebarToggle/>` from core's components, and style
 * `html[data-sidebar="collapsed"]` itself. The state is decided server-side and arrives as an
 * attribute on <html>, so the narrow rail is already in the first HTML here too.
 */
type Nav = Snippet<[{ orientation: 'vertical' | 'horizontal'; rail?: boolean }]>;
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

<div class="shell min-h-dvh md:grid md:grid-cols-[13rem_1fr]" data-layout="dummy.two-column">
  <aside id="sidebar-rail" class="hidden border-e bg-muted/40 p-3 md:sticky md:top-0 md:block md:h-dvh md:overflow-y-auto">
    <div class="mb-4 flex items-center gap-2" data-rail-head>
      <div class="min-w-0 flex-1 truncate" data-rail-brand>{@render brand()}</div>
      <SidebarToggle />
    </div>
    <nav aria-label="Navigasi utama" use:railExpand>{@render nav({ orientation: 'vertical', rail: true })}</nav>
  </aside>
  <div class="flex min-w-0 flex-col">
    <header class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      <details class="relative md:hidden" use:dropdown>
        <summary class="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent" aria-label="Buka menu">
          <Icon name="menu" />
        </summary>
        <nav class="absolute start-0 top-11 z-40 w-64 rounded-md border bg-popover p-3 shadow-lg" aria-label="Navigasi utama">
          {@render nav({ orientation: 'vertical' })}
        </nav>
      </details>
      <div class="md:hidden">{@render brand()}</div>
      <div class="ms-auto flex items-center gap-2">{@render header()}</div>
    </header>
    <div class="px-4 pt-3 text-sm text-muted-foreground">{@render breadcrumb()}</div>
    <div class={`grid flex-1 gap-6 px-4 pb-8 pt-2 ${aside ? 'lg:grid-cols-[2fr_1fr]' : ''}`}>
      <main id="content" class="min-w-0">{@render content()}</main>
      {#if aside}
        <aside id="dummy-second-column" class="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{@render aside()}</aside>
      {/if}
    </div>
    <footer class="border-t px-4 py-3 text-xs text-muted-foreground">{@render footer()}</footer>
  </div>
</div>

<style>
  /*
   * The collapsed rail (F-8), styled by the layout that owns it — core adds no rule for this
   * layout, and knows nothing about it. Same shape as `sidebar-classic`: labels clipped rather
   * than removed (so an icon-only link keeps its accessible name), sub-menus and the group chevron
   * dropped, and every rule off while a group is open, because a rail has nowhere to put children
   * — opening one is the request for the full width back. Logical properties only (K-9).
   */
  @media (min-width: 48rem) {
    :global(html[data-sidebar="collapsed"]) .shell:not(:has(#sidebar-rail details[open])) {
      grid-template-columns: 3.5rem 1fr;
    }
    :global(html[data-sidebar="collapsed"] #sidebar-rail:not(:has(details[open])) nav span) {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
    :global(html[data-sidebar="collapsed"] #sidebar-rail:not(:has(details[open])) nav ul ul),
    :global(html[data-sidebar="collapsed"] #sidebar-rail:not(:has(details[open])) nav summary > svg:last-child),
    :global(html[data-sidebar="collapsed"] #sidebar-rail:not(:has(details[open])) [data-rail-brand]) {
      display: none;
    }
    :global(html[data-sidebar="collapsed"] #sidebar-rail:not(:has(details[open])) nav a),
    :global(html[data-sidebar="collapsed"] #sidebar-rail:not(:has(details[open])) nav summary),
    :global(html[data-sidebar="collapsed"] #sidebar-rail:not(:has(details[open])) [data-rail-head]) {
      justify-content: center;
      padding-inline: 0;
    }
    :global(html[data-sidebar="collapsed"] #sidebar-rail:not(:has(details[open]))) {
      padding-inline: 0.375rem;
    }
  }
</style>
