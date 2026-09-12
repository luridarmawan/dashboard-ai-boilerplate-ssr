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
 * Confirmation before a step the user cannot take back by accident (L-21, L-22) — a deletion by
 * default, but `confirm` + `icon` + `confirmVariant` cover the softer ones too (archiving, …).
 * One markup, two paths:
 *   - no JavaScript: the trigger is a real link to `?confirm=<confirm>`; the server re-renders the
 *     page with `confirming` true and this component shows the confirmation inline;
 *   - with JavaScript: the click is intercepted and the same form opens in a modal — no
 *     navigation, focus trapped, Escape closes.
 * Both post to `<action>&confirm=<confirm>`; the action must refuse anything else (`confirmed()` in
 * `$lib/server/session`), because a confirmation that lives only in the markup is not one.
 */
interface Props {
  csrf: string;
  /** Where the no-JS trigger goes — must carry `confirm=<confirm>`. */
  href: string;
  /** Where "cancel" returns to in the inline confirmation. */
  cancelHref: string;
  /** True when the server saw `?confirm=<confirm>` (for a list, when it named this row). */
  confirming?: boolean;
  action?: string;
  /**
   * The token that says *which* confirmation this is, both in the URL and in the action's guard.
   * Two confirmations on one page (delete and archive, say) must not answer for each other.
   */
  confirm?: string;
  title?: string;
  /** What exactly is about to be deleted — say it in the caller's own words. */
  description?: string;
  label?: string;
  confirmLabel?: string;
  /** Look of the confirm button — red for a deletion, plain for a step that can be undone. */
  confirmVariant?: ButtonVariant;
  /** A bounced `confirm_failed`, shown next to the confirmation. */
  error?: string | null;
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  /** Row-sized: no alert box, buttons sit inline where the trigger was. */
  compact?: boolean;
  /** Compact, but the label still shows next to the icon on wide screens. */
  compactLabel?: boolean;
  /**
   * Glyph for the trigger and the confirm button. Defaults to the bin, but not every destructive
   * step is a deletion — removing someone from a group does not delete the person — and a trigger
   * that says "delete" about something else is a worse warning than no icon.
   */
  icon?: string;
  /** Extra hidden inputs the action needs (row id, current filter, …). */
  fields?: Snippet;
}
let {
  csrf,
  href,
  cancelHref,
  confirming = false,
  action = '?/delete',
  confirm = 'delete',
  title,
  description,
  label,
  confirmLabel,
  confirmVariant = 'destructive',
  error = null,
  variant = 'destructive',
  size = 'default',
  class: className,
  compact = false,
  compactLabel = false,
  icon = 'trash',
  fields,
}: Props = $props();
const t = useT();
let open = $state(false);
const heading = $derived(title ?? t('common.delete_confirm'));
const lead = $derived(description ?? t('common.delete_confirm_lead'));
const submitLabel = $derived(confirmLabel ?? t('common.delete_confirm_submit'));
const post = $derived(`${action}${action.includes('?') ? '&' : '?'}confirm=${confirm}`);
</script>

{#snippet form(inDialog: boolean)}
  <form method="POST" action={post} class={compact && !inDialog ? 'inline-flex flex-wrap items-center gap-2' : 'flex flex-wrap gap-2'}>
    <Csrf token={csrf} />
    {@render fields?.()}
    <Button type="submit" variant={confirmVariant} size={compact && !inDialog ? 'sm' : 'default'}>
      <Icon name={icon} size={16} />{submitLabel}
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
  <div class="grid gap-3" id={`confirm-${confirm}`}>
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
    title={label ?? t('common.delete')}
    onclick={(e) => {
      // Leave the modified clicks alone — the link still points at a real page.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      open = true;
    }}
  >
    <Icon name={icon} size={16} />{#if !compact}{label ?? t('common.delete')}{:else if compactLabel}<span class="hidden sm:inline">{label ?? t('common.delete')}</span>{/if}
  </a>
  <Dialog bind:open title={heading} description={lead}>
    {@render form(true)}
  </Dialog>
{/if}
