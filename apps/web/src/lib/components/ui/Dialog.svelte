<script lang="ts">
import { Dialog } from 'bits-ui';
import type { Snippet } from 'svelte';
import Icon from '$lib/components/Icon.svelte';
import { cn } from '$lib/utils';

/**
 * Modal dialog over bits-ui (focus trap, Escape, aria wiring — L-21). Progressive: the
 * `trigger` is a real button, and destructive confirmations should ALSO exist as a plain form
 * for no-JS visitors (L-22) — this component is the enhanced path, not the only path.
 */
interface Props {
  open?: boolean;
  title: string;
  description?: string;
  class?: string;
  trigger?: Snippet;
  children?: Snippet;
  footer?: Snippet;
}
let {
  open = $bindable(false),
  title,
  description,
  class: className,
  trigger,
  children,
  footer,
}: Props = $props();
</script>

<Dialog.Root bind:open>
  {#if trigger}<Dialog.Trigger>{@render trigger()}</Dialog.Trigger>{/if}
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-foreground/50" />
    <Dialog.Content
      class={cn(
        'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-popover p-6 text-popover-foreground shadow-lg',
        className,
      )}
    >
      <div class="grid gap-1.5">
        <Dialog.Title class="text-lg font-semibold leading-none">{title}</Dialog.Title>
        {#if description}<Dialog.Description class="text-sm text-muted-foreground">{description}</Dialog.Description>{/if}
      </div>
      {@render children?.()}
      {#if footer}<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{@render footer()}</div>{/if}
      <Dialog.Close class="absolute top-4 end-4 rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ring" aria-label="Tutup">
        <Icon name="close" size={16} />
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
