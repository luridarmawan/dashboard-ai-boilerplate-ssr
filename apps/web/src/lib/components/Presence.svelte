<script lang="ts">
/**
 * Online indicator (PRD D-5) — presentational only. The API decides `online` (it owns the window
 * and knows the session touch interval) and the calling dashboard page supplies the wording
 * (`presenceText` in `$lib/presence`), which is what keeps this component out of the anonymous
 * i18n payload while still living in `@core/ui` for modules to reuse.
 *
 * The dot alone would be a colour with no meaning, so the text is always in the DOM: visible when
 * `label`, screen-reader-only otherwise, and in `title` either way for a hover.
 */
interface Props {
  online: boolean;
  /** Already localised, e.g. "Online" or "Terakhir aktif 5 menit lalu". */
  text: string;
  /** Show the wording beside the dot; otherwise only assistive tech reads it. */
  label?: boolean;
  class?: string;
}
let { online, text, label = false, class: className = '' }: Props = $props();
</script>

<span class={`inline-flex items-center gap-1.5 ${className}`} title={text} data-testid="presence" data-online={online}>
  <span class={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground/40'}`} aria-hidden="true"></span>
  <span class={label ? 'text-sm text-muted-foreground' : 'sr-only'}>{text}</span>
</span>
