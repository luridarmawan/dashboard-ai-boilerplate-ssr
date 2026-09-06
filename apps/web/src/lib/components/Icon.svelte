<script lang="ts">
import { getContext } from 'svelte';
import { DEFAULT_ICON_SET, iconSets } from '$lib/icons';

/**
 * The only way a component draws an icon (PRD L-5): a semantic name, resolved through the
 * ACTIVE theme's icon set (from the root layout's `ui-theme` context). Switching theme swaps
 * every glyph on the page without touching a component. Unknown names fall back to the
 * default set and warn in dev — a missing core name is a build failure in CI, not a blank.
 */
interface Props {
  name: string;
  size?: number | string;
  class?: string;
  /** Screen-reader text; icons without one are decorative (aria-hidden). */
  label?: string;
}
let { name, size = 20, class: className = '', label }: Props = $props();

const theme = getContext<{ iconSet: string } | undefined>('ui-theme');
const setId = $derived(
  theme?.iconSet && iconSets[theme.iconSet] ? theme.iconSet : DEFAULT_ICON_SET,
);
const set = $derived(iconSets[setId] ?? iconSets[DEFAULT_ICON_SET]);
const Glyph = $derived.by(() => {
  const g = set?.glyphs[name] ?? iconSets[DEFAULT_ICON_SET]?.glyphs[name];
  if (!g && import.meta.env.DEV) console.warn(`<Icon name="${name}"> tidak ada di set ${setId}`);
  return g ?? null;
});
// Lucide takes strokeWidth; Phosphor takes weight. Pass both — each ignores the other.
const extra = $derived(
  set?.meta.style === 'fill' ? { weight: 'fill' } : { strokeWidth: set?.meta.strokeWidth ?? 1.75 },
);
</script>

{#if Glyph}
  <Glyph
    {size}
    class={`shrink-0 ${className}`}
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
    {...extra}
  />
{/if}
