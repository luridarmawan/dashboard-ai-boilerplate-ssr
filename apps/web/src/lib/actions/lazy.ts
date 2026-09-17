/**
 * Lazy loading, app-wide (PRD §8 "Performa — SSR": LCP < 2,5 s, termasuk landing page publik).
 *
 * There are two mechanisms here, and the first one is the one to reach for:
 *
 * 1. **`loading="lazy"`** — the browser's own, for `<img>` and `<iframe>`. No JavaScript, so it
 *    already works in the SSR'd HTML before hydration and with JavaScript off (L-22); the browser
 *    picks the distance threshold from the connection and the device, which no script can do; and
 *    nothing flashes or shifts as long as `width`/`height` are given. `<Img>` from `@core/ui`
 *    writes it (plus `decoding="async"`) for you — that is the recommended path for every image.
 *
 * 2. **`class="lazy"`** — this file. For the two things the browser cannot defer by itself: a CSS
 *    background image on a `<div>`, and an embed that must not be fetched until it is scrolled
 *    near. It needs JavaScript, so nothing a reader must be able to see may depend on it.
 *
 * The observer is document-wide and started once by the root layout, and a MutationObserver picks
 * up whatever a client-side navigation or an `{#if}` block adds later. A module therefore writes
 * markup and nothing else — no import, no `use:` action, no per-page setup:
 *
 *   <div class="lazy" data-bg="/uploads/hero.jpg"></div>
 *   <img class="lazy" data-src="/uploads/chart.png" width="800" height="400" alt="…" />
 *   <iframe class="lazy" data-src="https://…" title="…"></iframe>
 *
 * `use:lazy` is the same thing for one element, for the rare case where the element is not in the
 * document the root layout watches, or where a page wants it armed the moment it renders rather
 * than on the next mutation tick.
 */

/**
 * How far ahead of the viewport an element starts loading — about one phone screen. Short enough
 * that a reader who never scrolls never pays for it, long enough that one who does sees no gap.
 * Native `loading="lazy"` uses a larger, connection-aware distance; that asymmetry is fine,
 * because what goes through this path is decoration, not the thing being read.
 */
const ROOT_MARGIN = '300px';

/** Progress marker: CSS styles the wait, and a rescan skips what is already handled. */
const STATE_ATTR = 'data-lazy';

/** Elements the browser can defer on its own, given a `loading` attribute. */
const NATIVE_TAGS = new Set(['img', 'iframe']);

/** Not armed yet — what a scan looks for. */
const SELECTOR = `.lazy:not([${STATE_ATTR}])`;

/** What a `.lazy` element carries, read off the DOM once so the planning below stays pure. */
export type LazyTarget = {
  tag: string;
  dataSrc?: string | null;
  dataSrcset?: string | null;
  dataBg?: string | null;
  /** True when the markup already handed the browser a URL to fetch. */
  hasSrc: boolean;
};

export type LazyPlan = {
  /** Native attributes, applied immediately: the browser defers better than we can. */
  native: Record<string, string>;
  /** Attributes applied when the element comes near the viewport — the fetch starts here. */
  deferred: Record<string, string>;
  /** `background-image` for a `data-bg` element, applied together with `deferred`. */
  backgroundImage?: string | undefined;
  /** True when nothing is deferred in JavaScript, so there is no reason to observe the element. */
  nativeOnly: boolean;
  /** Dev-only: the class is not doing what its author expects on this element. */
  advice?: string | undefined;
};

/** One character as its percent-escape, e.g. `"` → `%22`. */
const pct = (c: string) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * Decide what a `.lazy` element needs, without touching the DOM.
 *
 * The one case worth spelling out is `<img class="lazy" src="…">`: by the time any script runs the
 * browser has read that `src` and may already be fetching it, so there is nothing left to defer.
 * We still set `loading="lazy"` — it is honoured as long as the fetch has not started — and say in
 * dev where the attribute belongs instead.
 */
export function planLazy(t: LazyTarget): LazyPlan {
  const tag = t.tag.toLowerCase();
  const native: Record<string, string> = {};
  const deferred: Record<string, string> = {};
  let backgroundImage: string | undefined;
  let advice: string | undefined;

  if (t.dataSrc) deferred.src = t.dataSrc;
  if (t.dataSrcset) deferred.srcset = t.dataSrcset;
  // The URL lands inside a CSS value, where a quote, a paren or a newline in the filename would
  // end it early and let the rest be read as CSS. Percent-encode exactly those characters — the
  // fetch decodes them back. (`encodeURIComponent` is not enough: it leaves ' ( ) as they are.)
  if (t.dataBg) backgroundImage = `url("${t.dataBg.replace(/["'()\\\n]/g, pct)}")`;

  if (NATIVE_TAGS.has(tag)) {
    native.loading = 'lazy';
    if (tag === 'img') native.decoding = 'async';
    if (t.hasSrc && !t.dataSrc) {
      advice = `<${tag} class="lazy" src="…"> — src sudah diambil browser sebelum skrip jalan. Tulis loading="lazy" di markup (atau pakai <Img> dari @core/ui), atau pindahkan url-nya ke data-src`;
    }
  } else if (!t.dataBg && !t.dataSrc) {
    advice = `<${tag} class="lazy"> tanpa data-bg/data-src — tidak ada yang bisa ditunda`;
  }

  const nativeOnly = !backgroundImage && Object.keys(deferred).length === 0;
  return { native, deferred, backgroundImage, nativeOnly, advice };
}

function readTarget(el: Element): LazyTarget {
  const data = (el as HTMLElement).dataset;
  return {
    tag: el.tagName,
    dataSrc: data.src ?? null,
    dataSrcset: data.srcset ?? null,
    dataBg: data.bg ?? null,
    hasSrc: !!el.getAttribute('src'),
  };
}

/** Start the deferred fetch. Idempotent: a second call on the same element does nothing. */
export function reveal(el: Element): void {
  const node = el as HTMLElement;
  if (node.dataset.lazy === 'loaded') return;
  const plan = planLazy(readTarget(el));
  for (const [name, value] of Object.entries(plan.deferred)) el.setAttribute(name, value);
  if (plan.backgroundImage) node.style.backgroundImage = plan.backgroundImage;
  node.dataset.lazy = 'loaded';
}

let observer: IntersectionObserver | null = null;

function intersectionObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  observer ??= new IntersectionObserver(
    (entries, io) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        reveal(entry.target);
      }
    },
    { rootMargin: ROOT_MARGIN },
  );
  return observer;
}

/**
 * Hand one element to the observer. The native attributes are applied right away; only an element
 * with something genuinely deferred (`data-src`, `data-bg`) is watched.
 */
export function arm(el: Element): void {
  const node = el as HTMLElement;
  if (node.dataset.lazy) return;
  const plan = planLazy(readTarget(el));
  if (import.meta.env.DEV && plan.advice) console.warn(plan.advice);
  for (const [name, value] of Object.entries(plan.native)) el.setAttribute(name, value);
  if (plan.nativeOnly) {
    node.dataset.lazy = 'native';
    return;
  }
  node.dataset.lazy = 'pending';
  const io = intersectionObserver();
  // No IntersectionObserver (a very old browser): load now. A heavier page beats a page whose
  // images never arrive.
  if (io) io.observe(el);
  else reveal(el);
}

function scan(root: ParentNode): void {
  if (root instanceof Element && root.matches(SELECTOR)) arm(root);
  for (const el of root.querySelectorAll(SELECTOR)) arm(el);
}

let mutations: MutationObserver | null = null;
let queued = false;

/**
 * Watch the document for `.lazy` elements — the whole app in one call, made by the root layout.
 * Returns the teardown.
 */
export function initLazy(doc: Document = document): () => void {
  scan(doc);
  if (!mutations && typeof MutationObserver !== 'undefined') {
    mutations = new MutationObserver((records) => {
      // A render adds many nodes in one tick, and one query per node would be wasteful: coalesce
      // into a single scan per frame, once the DOM has settled.
      if (queued) return;
      if (!records.some((r) => r.addedNodes.length > 0)) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        scan(doc);
      });
    });
    mutations.observe(doc.body, { childList: true, subtree: true });
  }
  return () => {
    mutations?.disconnect();
    mutations = null;
    observer?.disconnect();
    observer = null;
  };
}

/** `use:lazy` — arm this one element now, instead of waiting for the next document scan. */
export function lazy(node: Element) {
  arm(node);
  return {
    destroy() {
      observer?.unobserve(node);
    },
  };
}
