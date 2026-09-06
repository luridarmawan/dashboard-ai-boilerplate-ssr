<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
import { cn } from '$lib/utils';
import { type ButtonSize, type ButtonVariant, buttonVariants } from './button.ts';

/** Renders <a> when `href` is given, else <button> — same look, right semantics (L-21). */
type Props = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  href?: string;
  children?: Snippet;
} & Omit<HTMLButtonAttributes, 'class'> &
  Omit<HTMLAnchorAttributes, 'class' | 'href' | 'type'>;

let {
  variant = 'default',
  size = 'default',
  class: className,
  href,
  children,
  type = 'button',
  ...rest
}: Props = $props();
</script>

{#if href}
  <a {href} class={cn(buttonVariants({ variant, size }), className)} {...rest}>{@render children?.()}</a>
{:else}
  <button {type} class={cn(buttonVariants({ variant, size }), className)} {...rest}>{@render children?.()}</button>
{/if}
