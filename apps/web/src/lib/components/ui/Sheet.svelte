<script lang="ts">
import { Dialog } from 'bits-ui';
import type { Snippet } from 'svelte';
import Icon from '$lib/components/Icon.svelte';
import { cn } from '$lib/utils';

/** Side panel (drawer) — a dialog anchored to an edge. Used for filters and mobile nav. */
interface Props {
  open?: boolean;
  title: string;
  side?: 'left' | 'right';
  class?: string;
  trigger?: Snippet;
  children?: Snippet;
}
let {
  open = $bindable(false),
  title,
  side = 'right',
  class: className,
  trigger,
  children,
}: Props = $props();
</script>

<Dialog.Root bind:open>
  {#if trigger}<Dialog.Trigger>{@render trigger()}</Dialog.Trigger>{/if}
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-foreground/50" />
    <Dialog.Content
      class={cn(
        'fixed inset-y-0 z-50 flex w-[min(20rem,calc(100%-2rem))] flex-col gap-4 border-border bg-background p-6 shadow-lg',
        side === 'left' ? 'start-0 border-e' : 'end-0 border-s',
        className,
      )}
    >
      <div class="flex items-center justify-between">
        <Dialog.Title class="text-base font-semibold">{title}</Dialog.Title>
        <Dialog.Close class="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ring" aria-label="Tutup">
          <Icon name="close" size={16} />
        </Dialog.Close>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">{@render children?.()}</div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
