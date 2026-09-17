<script lang="ts">
import type { HTMLImgAttributes } from 'svelte/elements';
import { cssUrl } from '$lib/actions/lazy';

/**
 * The only `<img>` a page or a module should need. Lazy by default, and lazy the browser's way:
 * `loading="lazy"` + `decoding="async"` are in the SSR'd HTML, so an image below the fold is not
 * fetched before it is scrolled near — with no JavaScript involved, nothing to hydrate, and no
 * flash when it arrives (see `$lib/actions/lazy.ts` for the `class="lazy"` half, which is only
 * for what the browser cannot defer itself).
 *
 * The exception is the image a page is *judged* on: the hero, the product photo above the fold.
 * `loading="lazy"` on the LCP element delays the very thing the metric measures, so mark it
 * `priority` — eager, and asking to be fetched before the rest.
 *
 * `width`/`height` are the intrinsic pixel size (the aspect ratio is what matters, not the CSS
 * size): with them the browser reserves the slot before the stylesheet lands, and the page does
 * not jump when the image drops in. Without them, dev says so.
 *
 * A reserved slot is still an empty slot until the pixels arrive, so the element carries its own
 * placeholder: `data-img="loading"` (skeleton, or a blur-up thumbnail if one is given) until the
 * image reports `load`, `data-img="error"` if it never arrives — a muted frame with a small glyph
 * instead of the browser's broken-image icon. The state lives on the `<img>` itself rather than
 * in a wrapper, because callers size these with `class="h-full w-full object-cover"` inside their
 * own box and an extra element would break that layout. Styling: see `app.css`.
 */
interface Props extends Omit<HTMLImgAttributes, 'loading' | 'decoding' | 'fetchpriority'> {
  src: string;
  /** Empty string for a decorative image — never leave it out. */
  alt: string;
  width?: number | string;
  height?: number | string;
  /** Above the fold / the LCP candidate: load eagerly and ask for priority. */
  priority?: boolean;
  /**
   * What fills the slot while the image is on its way:
   * - `'skeleton'` (default) — a muted, pulsing frame, the same one `<Skeleton>` uses.
   * - `'none'` — nothing. For a transparent logo or an `object-contain` image, where a filled
   *   frame would read as part of the picture.
   * - any URL or `data:` URI — shown cover-filled and static: a tiny thumbnail (LQIP) blurs up
   *   into the real image. Nothing generates these for you; pass one only if you have it.
   */
  placeholder?: 'skeleton' | 'none' | (string & {});
  class?: string;
  style?: string;
}
let {
  src,
  alt,
  width,
  height,
  priority = false,
  placeholder = 'skeleton',
  class: className,
  style,
  ...rest
}: Props = $props();

/**
 * Which image the outcome belongs to, so that swapping `src` (a different product, a filtered
 * list) puts the placeholder back instead of showing the previous image's verdict.
 */
let settled = $state<{ src: string; ok: boolean } | null>(null);
const status = $derived(
  settled?.src === src ? (settled.ok ? 'loaded' : 'error') : ('loading' as const),
);

const kind = $derived(placeholder === 'skeleton' || placeholder === 'none' ? placeholder : 'image');
// A caller's own `style` is kept: the placeholder only adds a background to it.
const styleAttr = $derived(
  [kind === 'image' && status === 'loading' ? `background-image:${cssUrl(placeholder)}` : '', style]
    .filter(Boolean)
    .join(';') || undefined,
);

let el = $state<HTMLImageElement>();
// An image that was already in the cache can finish before hydration. Svelte replays the `load`
// it captured in the SSR'd markup, and `complete` covers the rest.
$effect(() => {
  if (el?.complete) settled = { src, ok: el.naturalWidth > 0 };
});

if (import.meta.env.DEV) {
  $effect(() => {
    if (width === undefined || height === undefined) {
      console.warn(
        `<Img src="${src}"> tanpa width/height — ruang gambar tidak bisa dicadangkan, tata letak akan bergeser saat gambar mendarat (CLS)`,
      );
    }
  });
}
</script>

<img
  bind:this={el}
  {src}
  {alt}
  {width}
  {height}
  class={className}
  style={styleAttr}
  loading={priority ? 'eager' : 'lazy'}
  decoding="async"
  fetchpriority={priority ? 'high' : undefined}
  data-img={status}
  data-placeholder={kind}
  onload={() => {
    settled = { src, ok: true };
  }}
  onerror={() => {
    settled = { src, ok: false };
  }}
  {...rest}
/>
