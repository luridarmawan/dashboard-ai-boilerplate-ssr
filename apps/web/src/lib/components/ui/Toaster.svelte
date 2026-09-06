<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { cn } from '$lib/utils';
import { dismiss, toasts } from './toast.svelte.ts';

const styles = {
  info: 'border-border',
  success: 'border-success/50',
  warning: 'border-warning/50',
  error: 'border-destructive/50',
} as const;
</script>

<div class="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class={cn('pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg', styles[t.variant])} role="status">
      <Icon name={t.variant === 'info' ? 'info' : t.variant} class="mt-0.5" />
      <div class="flex-1">
        <p class="font-medium">{t.title}</p>
        {#if t.description}<p class="text-muted-foreground">{t.description}</p>{/if}
      </div>
      <button type="button" class="opacity-70 hover:opacity-100" aria-label="Tutup" onclick={() => dismiss(t.id)}>
        <Icon name="close" size={16} />
      </button>
    </div>
  {/each}
</div>
