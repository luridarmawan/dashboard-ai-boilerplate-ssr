<script lang="ts">
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils';

/** Table shell: horizontal scroll on narrow screens (360 px baseline), token borders. */
let {
  class: className,
  children,
  caption,
}: { class?: string; children?: Snippet; caption?: string } = $props();
</script>

<div class="relative w-full overflow-x-auto rounded-lg border bg-card">
  <table class={cn('w-full caption-bottom text-sm [&_th]:h-10 [&_th]:px-3 [&_th]:text-left [&_th]:align-middle [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:p-3 [&_td]:align-middle [&_thead_tr]:border-b [&_tbody_tr]:border-b [&_tbody_tr:last-child]:border-0 [&_tbody_tr:hover]:bg-muted/50', className)}>
    {#if caption}<caption class="mt-4 text-sm text-muted-foreground">{caption}</caption>{/if}
    {@render children?.()}
  </table>
</div>
