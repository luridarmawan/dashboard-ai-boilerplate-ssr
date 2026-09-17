<script lang="ts">
import type { HTMLImgAttributes } from 'svelte/elements';

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
 */
interface Props extends Omit<HTMLImgAttributes, 'loading' | 'decoding' | 'fetchpriority'> {
  src: string;
  /** Empty string for a decorative image — never leave it out. */
  alt: string;
  width?: number | string;
  height?: number | string;
  /** Above the fold / the LCP candidate: load eagerly and ask for priority. */
  priority?: boolean;
  class?: string;
}
let { src, alt, width, height, priority = false, class: className, ...rest }: Props = $props();

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
  {src}
  {alt}
  {width}
  {height}
  class={className}
  loading={priority ? 'eager' : 'lazy'}
  decoding="async"
  fetchpriority={priority ? 'high' : undefined}
  {...rest}
/>
