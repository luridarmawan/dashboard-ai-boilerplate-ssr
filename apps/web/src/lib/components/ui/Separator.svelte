<script lang="ts">
import { cn } from '$lib/utils';

let { class: className, vertical = false }: { class?: string; vertical?: boolean } = $props();
</script>

<div role="separator" aria-orientation={vertical ? 'vertical' : 'horizontal'} class={cn('shrink-0 bg-border', vertical ? 'h-full w-px' : 'h-px w-full', className)}></div>
