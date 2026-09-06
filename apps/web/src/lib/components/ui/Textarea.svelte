<script lang="ts">
import type { HTMLTextareaAttributes } from 'svelte/elements';
import { cn } from '$lib/utils';

let {
  class: className,
  value = $bindable(),
  ...rest
}: HTMLTextareaAttributes & { class?: string } = $props();
</script>

<textarea
  bind:value
  class={cn(
    'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...rest}
></textarea>
