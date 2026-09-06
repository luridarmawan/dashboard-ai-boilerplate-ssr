<script lang="ts">
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils';

interface Props {
  id?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  class?: string | undefined;
  children?: Snippet;
  footer?: Snippet;
  actions?: Snippet;
}
let { id, title, description, class: className, children, footer, actions }: Props = $props();
</script>

<section {id} class={cn('rounded-lg border bg-card text-card-foreground shadow-xs', className)}>
  {#if title || actions}
    <header class="flex items-start justify-between gap-4 p-5 pb-0">
      <div>
        {#if title}<h2 class="text-base font-semibold leading-none tracking-tight">{title}</h2>{/if}
        {#if description}<p class="mt-1.5 text-sm text-muted-foreground">{description}</p>{/if}
      </div>
      {#if actions}<div class="flex shrink-0 gap-2">{@render actions()}</div>{/if}
    </header>
  {/if}
  <div class="p-5">{@render children?.()}</div>
  {#if footer}<footer class="flex items-center gap-2 border-t p-5 py-3">{@render footer()}</footer>{/if}
</section>
