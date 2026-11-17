<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';
import { cn } from '$lib/utils';
import { dismiss, toasts } from './toast.svelte.ts';

const t = useT();

// Success and error are filled (green / red) so the outcome reads at a glance; info and
// warning stay on the popover surface.
const styles = {
  info: 'border-border bg-popover text-popover-foreground',
  success: 'border-success bg-success text-success-foreground',
  warning: 'border-warning/50 bg-popover text-popover-foreground',
  error: 'border-destructive bg-destructive text-destructive-foreground',
} as const;
const filled = (v: keyof typeof styles) => v === 'success' || v === 'error';
</script>

<div class="pointer-events-none fixed end-4 bottom-4 z-[60] flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2" aria-live="polite">
  {#each toasts as item (item.id)}
    <div class={cn('pointer-events-auto flex items-start gap-3 rounded-lg border p-4 text-sm shadow-lg', styles[item.variant])} role="status" data-variant={item.variant}>
      <Icon name={item.variant === 'info' ? 'info' : item.variant} class="mt-0.5" />
      <div class="flex-1">
        <p class="font-medium">{item.title}</p>
        {#if item.description}<p class={filled(item.variant) ? 'opacity-90' : 'text-muted-foreground'}>{item.description}</p>{/if}
      </div>
      <button type="button" class="opacity-70 hover:opacity-100" aria-label={t('common.close')} onclick={() => dismiss(item.id)}>
        <Icon name="close" size={16} />
      </button>
    </div>
  {/each}
</div>
