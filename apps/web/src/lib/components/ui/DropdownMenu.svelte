<script lang="ts">
import { DropdownMenu } from 'bits-ui';
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils';

/**
 * Menu of actions. Items are `{ label, href?, onselect?, icon?, destructive? }`; an item with an
 * href renders as a link so it keeps working as plain navigation.
 */
export interface MenuItem {
  label: string;
  href?: string;
  onselect?: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
}
interface Props {
  items: MenuItem[];
  align?: 'start' | 'end';
  class?: string;
  trigger: Snippet;
}
let { items, align = 'end', class: className, trigger }: Props = $props();
const itemClass =
  'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground';
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>{@render trigger()}</DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      {align}
      sideOffset={4}
      class={cn('z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md', className)}
    >
      {#each items as item, i (item.label + i)}
        {#if item.separatorBefore}<DropdownMenu.Separator class="-mx-1 my-1 h-px bg-border" />{/if}
        {#if item.href}
          <DropdownMenu.Item class={cn(itemClass, item.destructive && 'text-destructive')}>
            {#snippet child({ props })}<a href={item.href} {...props}>{item.label}</a>{/snippet}
          </DropdownMenu.Item>
        {:else}
          <DropdownMenu.Item class={cn(itemClass, item.destructive && 'text-destructive')} onSelect={() => item.onselect?.()}>
            {item.label}
          </DropdownMenu.Item>
        {/if}
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
