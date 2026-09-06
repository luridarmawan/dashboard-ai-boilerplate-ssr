<script lang="ts">
import type { HTMLInputAttributes } from 'svelte/elements';
import { cn } from '$lib/utils';

/** Native checkbox styled with tokens: submits with plain forms (L-22). */
let {
  class: className,
  checked = $bindable(),
  ...rest
}: HTMLInputAttributes & { class?: string } = $props();
</script>

<input
  type="checkbox"
  bind:checked
  class={cn(
    'h-4 w-4 shrink-0 rounded-sm border border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...rest}
/>
