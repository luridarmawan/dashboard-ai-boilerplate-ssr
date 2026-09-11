<script lang="ts">
import type { Snippet } from 'svelte';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';
import { cn } from '$lib/utils';
import Alert from './Alert.svelte';
import Button from './Button.svelte';
import { type ButtonSize, type ButtonVariant, buttonVariants } from './button.ts';
import Dialog from './Dialog.svelte';

/**
 * Destructive confirmation in both directions (L-21, L-22). One markup, two paths:
 *   - no JavaScript: the trigger is a real link to `?confirm=delete`; the server re-renders the
 *     page with `confirming` true and this component shows the confirmation inline;
 *   - with JavaScript: the click is intercepted and the same form opens in a modal — no
 *     navigation, focus trapped, Escape closes.
 * Both post to `<action>&confirm=delete`; the action must refuse anything else (`confirmed()` in
 * `$lib/server/session`), because a confirmation that lives only in the markup is not one.
 */
interface Props {
  csrf: string;
  /** Where the no-JS trigger goes — must carry `confirm=delete`. */
  href: string;
  /** Where "cancel" returns to in the inline confirmation. */
  cancelHref: string;
  /** True when the server saw `?confirm=delete` (for a list, when it named this row). */
  confirming?: boolean;
  action?: string;
  title?: string;
  /** What exactly is about to be deleted — say it in the caller's own words. */
  description?: string;
  label?: string;
  confirmLabel?: string;
  /** A bounced `confirm_failed`, shown next to the confirmation. */
  error?: string | null;
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  /** Row-sized: no alert box, buttons sit inline where the trigger was. */
  compact?: boolean;
  /** Extra hidden inputs the action needs (row id, current filter, …). */
  fields?: Snippet;
}
let {
  csrf,
  href,
  cancelHref,
  confirming = false,
  action = '?/delete',
  title,
  description,
  label,
  confirmLabel,
  error = null,
  variant = 'destructive',
  size = 'default',
  class: className,
  compact = false,
  fields,
}: Props = $props();
const t = useT();
let open = $state(false);
const heading = $derived(title ?? t('common.delete_confirm'));
const lead = $derived(description ?? t('common.delete_confirm_lead'));
const submitLabel = $derived(confirmLabel ?? t('common.delete_confirm_submit'));
const post = $derived(`${action}${action.includes('?') ? '&' : '?'}confirm=delete`);
</script>

{#snippet form(inDialog: boolean)}
  <form method="POST" action={post} class={compact && !inDialog ? 'inline-flex flex-wrap items-center gap-2' : 'flex flex-wrap gap-2'}>
    <Csrf token={csrf} />
    {@render fields?.()}
    <Button type="submit" variant="destructive" size={compact && !inDialog ? 'sm' : 'default'}>
      <Icon name="trash" size={16} />{submitLabel}
    </Button>
    {#if inDialog}
      <Button variant="secondary" onclick={() => { open = false; }}>{t('common.cancel')}</Button>
    {:else}
      <Button href={cancelHref} variant="secondary" size={compact ? 'sm' : 'default'}>{t('common.cancel')}</Button>
    {/if}
  </form>
{/snippet}

{#if confirming}
  <!-- No-JavaScript path: the server rendered the confirmation, the form below is the second step. -->
  <div class="grid gap-3" id="confirm-delete">
    {#if compact}
      <p class="text-sm font-medium">{heading}</p>
    {:else}
      <Alert variant="error" title={heading}><p>{lead}</p></Alert>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {@render form(false)}
  </div>
{:else}
  <!--
    A link, not a button: without JavaScript it navigates to the confirmation above; with it, the
    click never leaves the page and opens the same form in a modal.
  -->
  <a
    {href}
    class={cn(buttonVariants({ variant, size }), className)}
    aria-haspopup="dialog"
    aria-label={label ?? t('common.delete')}
    onclick={(e) => {
      // Leave the modified clicks alone — the link still points at a real page.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      open = true;
    }}
  >
    <Icon name="trash" size={16} />{#if !compact}{label ?? t('common.delete')}{/if}
  </a>
  <Dialog bind:open title={heading} description={lead}>
    {@render form(true)}
  </Dialog>
{/if}
