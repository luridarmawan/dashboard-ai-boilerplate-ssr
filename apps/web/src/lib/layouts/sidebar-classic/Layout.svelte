<script lang="ts">
import { dropdown } from '$lib/actions/dropdown';
import Icon from '$lib/components/Icon.svelte';
import SidebarToggle from '$lib/components/SidebarToggle.svelte';
import type { DashboardRegions } from '$lib/layouts/types';

/**
 * `sidebar-classic` — left sidebar (nav) + header; nav collapses into <details> under md (no JS needed).
 * From md up the rail itself can be collapsed to icons (F-8): the state arrives as `data-sidebar`
 * on <html> (decided server-side, see lib/server/sidebar.ts), so the narrow rail is already in the
 * first byte. A layout owns its rail, so it renders the toggle itself — layouts without a sidebar
 * (topnav-compact, centered-narrow) simply do not, and the state means nothing to them.
 */
let { brand, nav, header, breadcrumb, content, aside, footer }: DashboardRegions = $props();
</script>

<div class="shell min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
  <aside id="sidebar-rail" class="hidden border-e bg-card md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
    <div class="flex h-14 items-center gap-2 border-b px-4" data-rail-head>
      <div class="min-w-0 flex-1 truncate" data-rail-brand>{@render brand()}</div>
      <SidebarToggle />
    </div>
    <nav class="flex-1 overflow-y-auto p-3" aria-label="Navigasi utama">{@render nav({ orientation: 'vertical' })}</nav>
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
      <div id="nav-top-right-user-classic" class="ms-auto flex items-center gap-2">{@render header()}</div>
    </header>

    <div class="px-4 pt-3 text-sm text-muted-foreground">{@render breadcrumb()}</div>

    <div class="flex flex-1 gap-6 px-4 pb-8 pt-2 {aside ? 'lg:grid lg:grid-cols-[1fr_18rem]' : ''}">
      <main id="content" class="min-w-0 flex-1">{@render content()}</main>
      {#if aside}<aside class="mt-6 lg:mt-0">{@render aside()}</aside>{/if}
    </div>

    <footer class="border-t px-4 py-3 text-xs text-muted-foreground">{@render footer()}</footer>
  </div>
</div>

<style>
  /*
   * The collapsed rail (F-8). The markup inside it — brand and nav — comes from the SHELL's
   * snippets, not from this file, so the rules are `:global` and scoped to `#sidebar-rail`, which
   * only this layout renders (the same trade `topnav-compact` makes for its menu). Below md the
   * rail is not rendered at all, so every rule sits behind the same breakpoint the grid uses.
   *
   * Labels are hidden the accessible way (clipped, not `display:none`), so an icon-only link keeps
   * its accessible name for screen readers and for the axe checks in the M2 gate. Logical
   * properties only (K-9).
   */
  @media (min-width: 48rem) {
    /* The rail's own width — the one rule that touches this layout's own element. */
    :global(html[data-sidebar="collapsed"]) .shell {
      grid-template-columns: 3.5rem 1fr;
    }
    :global(html[data-sidebar="collapsed"] #sidebar-rail nav span) {
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
    /* Only the top level survives in a rail: sub-menus and the group chevron need the width. */
    :global(html[data-sidebar="collapsed"] #sidebar-rail nav ul ul),
    :global(html[data-sidebar="collapsed"] #sidebar-rail nav summary > svg:last-child) {
      display: none;
    }
    /* One centred glyph per row, and no padding to squeeze it out of a 3.5rem rail. */
    :global(html[data-sidebar="collapsed"] #sidebar-rail nav a),
    :global(html[data-sidebar="collapsed"] #sidebar-rail nav summary) {
      justify-content: center;
      padding-inline: 0;
    }
    :global(html[data-sidebar="collapsed"] #sidebar-rail nav) {
      padding-inline: 0.375rem;
    }
    /*
     * A 3.5rem rail has room for exactly one control, and it must be the way back out: the brand
     * steps aside (it is still in the nav as Dashboard, and in the mobile header) so the toggle
     * sits centred where the logo was.
     */
    :global(html[data-sidebar="collapsed"] #sidebar-rail [data-rail-brand]) {
      display: none;
    }
    :global(html[data-sidebar="collapsed"] #sidebar-rail [data-rail-head]) {
      justify-content: center;
      padding-inline: 0.375rem;
    }
  }
</style>
