<script lang="ts">
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils';

/** Label + control + hint/error, stacked. The workhorse of every form in the app. */
interface Props {
  label?: string | undefined;
  for?: string | undefined;
  hint?: string | undefined;
  error?: string | null | undefined;
  required?: boolean | undefined;
  class?: string | undefined;
  children?: Snippet;
}
let {
  label,
  for: htmlFor,
  hint,
  error,
  required = false,
  class: className,
  children,
}: Props = $props();
</script>

<div class={cn('grid gap-1.5', className)}>
  {#if label}
    <label for={htmlFor} class="text-sm font-medium leading-none">
      {label}{#if required}<span class="text-destructive" aria-hidden="true"> *</span>{/if}
    </label>
  {/if}
  {@render children?.()}
  {#if error}
    <p class="text-sm text-destructive" role="alert">{error}</p>
  {:else if hint}
    <p class="text-sm text-muted-foreground">{hint}</p>
  {/if}
</div>
