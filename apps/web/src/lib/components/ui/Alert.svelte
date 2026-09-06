<script lang="ts">
import type { Snippet } from 'svelte';
import Icon from '$lib/components/Icon.svelte';
import { cn } from '$lib/utils';

/** Inline status message. `role` is chosen for assistive tech: errors interrupt, info does not. */
interface Props {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  class?: string;
  children?: Snippet;
}
let { variant = 'info', title, class: className, children }: Props = $props();
const styles = {
  info: 'border-border bg-card text-card-foreground',
  success: 'border-success/40 bg-success/10 text-foreground',
  warning: 'border-warning/40 bg-warning/10 text-foreground',
  error: 'border-destructive/40 bg-destructive/10 text-foreground',
} as const;
const icons = { info: 'info', success: 'success', warning: 'warning', error: 'error' } as const;
</script>

<div
  role={variant === 'error' ? 'alert' : 'status'}
  class={cn('flex gap-3 rounded-lg border p-4 text-sm', styles[variant], className)}
>
  <Icon name={icons[variant]} class="mt-0.5" />
  <div class="grid gap-1">
    {#if title}<p class="font-medium leading-none">{title}</p>{/if}
    {#if children}<div class="[&_p]:leading-relaxed">{@render children()}</div>{/if}
  </div>
</div>
