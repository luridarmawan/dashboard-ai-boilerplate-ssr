<script lang="ts">
import type { Snippet } from 'svelte';
import { tv } from 'tailwind-variants';
import { cn } from '$lib/utils';

const badge = tv({
  base: 'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
      success: 'border-transparent bg-success text-success-foreground',
      warning: 'border-transparent bg-warning text-warning-foreground',
      destructive: 'border-transparent bg-destructive text-destructive-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});
interface Props {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';
  class?: string;
  children?: Snippet;
}
let { variant = 'default', class: className, children }: Props = $props();
</script>

<span class={cn(badge({ variant }), className)}>{@render children?.()}</span>
