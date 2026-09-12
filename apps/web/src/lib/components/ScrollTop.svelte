<script lang="ts">
import { onMount } from 'svelte';
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';

/**
 * Back to top — on every page of the app (dashboard, auth, public), for the long ones: a product
 * catalogue, the outbox, an audit list. This is the one shell control that is JavaScript-only:
 * nothing in the document can tell how far the reader has scrolled without it, and a button that
 * is always there would be noise. Without JavaScript the corner simply stays empty — L-22 is about
 * the forms that carry the work, not about a shortcut back to a header the reader can still reach.
 *
 * It docks in the bottom-end corner, which a shell widget (H-13, extension point 11) may already
 * own: a widget marked `data-shell-dock="bottom-end"` pushes this button above it, and while that
 * widget is open (`data-shell-dock-open`) the corner is the widget's alone. Both rules are CSS, so
 * neither side has to know the other exists.
 */
const t = useT();
/** How far down the reader must be before the button earns its place, in pixels. */
const THRESHOLD = 400;
let visible = $state(false);

onMount(() => {
  const update = () => {
    visible = window.scrollY > THRESHOLD;
  };
  update();
  // Passive: this never calls preventDefault, and scrolling must not wait for it.
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  return () => {
    window.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
  };
});

function toTop() {
  // Smooth, unless the reader asked for less motion — then jump, which is what they asked for.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
}
</script>

{#if visible}
  <button
    type="button"
    onclick={toTop}
    title={t('shell.scroll_top')}
    aria-label={t('shell.scroll_top')}
    data-testid="scroll-top"
    class="scroll-top fixed end-4 bottom-4 z-40 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border bg-card text-foreground shadow-lg hover:bg-accent hover:text-accent-foreground print:hidden"
  >
    <Icon name="chevron-up" size={20} />
  </button>
{/if}

<style>
  /*
   * A shell widget that docks in the same corner — the AI module's floating chat — marks itself
   * `data-shell-dock="bottom-end"`. It is a sibling rendered by another component (a module's, at
   * that), so the match has to start from <body>; only the `.scroll-top` half is scoped here.
   */
  :global(body:has([data-shell-dock="bottom-end"])) .scroll-top {
    bottom: 4.5rem;
  }
  /* While such a widget is open its panel fills the corner: step out of the way entirely. */
  :global(body:has([data-shell-dock="bottom-end"][data-shell-dock-open])) .scroll-top {
    display: none;
  }
</style>
