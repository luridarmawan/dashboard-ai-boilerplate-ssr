<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLSelectAttributes } from 'svelte/elements';
import { cn } from '$lib/utils';

/** Native <select>: works without JavaScript (L-22) and with every screen reader. */
let {
  class: className,
  value = $bindable(),
  children,
  ...rest
}: HTMLSelectAttributes & { class?: string; children?: Snippet } = $props();
</script>

<select
  bind:value
  class={cn(
    'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...rest}
>
  {@render children?.()}
</select>
