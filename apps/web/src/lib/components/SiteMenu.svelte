<script lang="ts">
import { dropdown } from '$lib/actions/dropdown';
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';
import type { NavOrientation } from '$lib/layouts/types';
import type { SiteMenuLink } from '$lib/server/public-nav';

/**
 * The admin-assembled menu bar of the public header (`site.menubar`), any depth. Built on
 * `<details>` so every submenu opens without JavaScript; `use:dropdown` then adds what a popover
 * owes (outside click, Escape, one open branch at a time). Horizontal = dropdown panels with
 * flyouts to the inline end; vertical (the mobile menu) = an indented accordion, never popovers
 * over the links. A parent that is also a page gets a "view all" link at the top of its panel,
 * because its summary only opens the panel.
 */
let { items, orientation }: { items: readonly SiteMenuLink[]; orientation: NavOrientation } =
  $props();
const t = useT();
const horizontal = $derived(orientation === 'horizontal');
const linkClass =
  'block rounded-md px-3 py-2 text-foreground no-underline hover:bg-accent hover:text-accent-foreground hover:no-underline aria-[current=page]:font-semibold aria-[current=page]:text-primary';
const summaryClass =
  'flex cursor-pointer list-none items-center justify-between gap-1 rounded-md px-3 py-2 hover:bg-accent hover:text-accent-foreground [&::-webkit-details-marker]:hidden';
</script>

{#snippet link(it: SiteMenuLink, label: string)}
  {#if it.href}
    <a
      href={it.href}
      class={linkClass}
      aria-current={it.current ? 'page' : undefined}
      {...it.external ? { rel: 'noopener', target: '_blank' } : {}}
    >{label}</a>
  {:else}
    <span class="block px-3 py-2 text-muted-foreground">{label}</span>
  {/if}
{/snippet}

{#snippet branch(list: readonly SiteMenuLink[], level: number)}
  {#each list as it, i (`${level}:${i}:${it.label}`)}
    <li class={horizontal ? 'relative' : ''}>
      {#if it.children.length}
        <details use:dropdown={horizontal} class="group">
          <summary class={`${summaryClass} ${it.active ? 'font-semibold text-primary' : ''}`}>
            <span>{it.label}</span>
            <Icon
              name={horizontal && level > 0 ? 'chevron-right' : 'chevron-down'}
              size={16}
              class={`transition-transform ${horizontal && level > 0 ? 'rtl:rotate-180' : 'group-open:rotate-180'}`}
            />
          </summary>
          <ul
            class={horizontal
              ? `absolute z-40 grid min-w-52 gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg ${level === 0 ? 'start-0 top-full mt-1' : 'start-full top-0 ms-1'}`
              : 'ms-3 grid gap-0.5 border-s ps-2'}
          >
            {#if it.href}
              <!--
              <li>{@render link(it, t('nav.menu_view_all'))}</li>
              -->
            {/if}
            {@render branch(it.children, level + 1)}
          </ul>
        </details>
      {:else}
        {@render link(it, it.label)}
      {/if}
    </li>
  {/each}
{/snippet}

<ul class={horizontal ? 'flex flex-wrap items-center gap-0.5 text-sm' : 'grid gap-0.5 text-sm'}>
  {@render branch(items, 0)}
</ul>
