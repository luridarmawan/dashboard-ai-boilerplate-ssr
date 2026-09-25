/**
 * `use:autoSlide` on a `.marquee` row: advance one card at a time, and let the reader swipe.
 *
 * Without JavaScript the row is already usable — CSS makes it a horizontally scrollable strip
 * with snap points (touch swipe, trackpad, shift+wheel) that shows one copy of the items. This
 * action only adds on top of that:
 *   - the second copy of the items is revealed (`data-enhanced`), so the loop can wrap seamlessly;
 *   - every `interval` ms the row scrolls by one card, unless the reader is hovering, dragging,
 *     has focus inside it, the tab is hidden, or they touched it less than `resume` ms ago;
 *   - a mouse can drag the row, since a desktop mouse cannot swipe;
 *   - once a scroll settles past the first copy, the position jumps back by exactly one copy —
 *     the same picture, so the reader never sees the seam.
 * A reader who asked for reduced motion keeps the plain swipeable row: no autoplay, one copy.
 */
export interface AutoSlideOptions {
  /** Milliseconds between automatic steps. */
  interval?: number;
  /** Milliseconds autoplay waits after the reader scrolled, swiped or dragged. */
  resume?: number;
}

/**
 * Fold a scroll offset back into the first copy. `period` is the distance from the first item to
 * its duplicate; within half a pixel of a full period counts as the start (sub-pixel layout).
 */
export function wrapOffset(x: number, period: number): number {
  if (!(period > 0) || x < 0) return x;
  const r = x % period;
  return period - r < 0.5 ? 0 : r;
}

export function autoSlide(node: HTMLElement, opts: AutoSlideOptions = {}) {
  const interval = opts.interval ?? 3500;
  const resume = opts.resume ?? 6000;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return {};
  node.dataset.enhanced = 'true';

  const items = () => node.querySelectorAll<HTMLElement>('.marquee-item');
  const dir = () => (getComputedStyle(node).direction === 'rtl' ? -1 : 1);
  const gap = (a: number, b: number) => {
    const li = items();
    const x = li[a];
    const y = li[b];
    return x && y ? Math.abs(y.offsetLeft - x.offsetLeft) : 0;
  };
  const period = () => gap(0, items().length / 2);
  const step = () => gap(0, 1) || node.clientWidth;

  let holdUntil = 0;
  let hovering = false;
  let drag: { x: number; left: number; id: number } | null = null;
  const hold = () => {
    holdUntil = Date.now() + resume;
  };

  const wrap = () => {
    const x = Math.abs(node.scrollLeft);
    const w = wrapOffset(x, period());
    if (w !== x) node.scrollLeft = dir() * w;
  };
  let settle: ReturnType<typeof setTimeout> | undefined;
  const onScroll = () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (!drag) wrap();
    }, 150);
  };

  const onEnter = () => {
    hovering = true;
  };
  const onLeave = () => {
    hovering = false;
  };
  const onPointerDown = (e: PointerEvent) => {
    hold();
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: node.scrollLeft, id: e.pointerId };
    node.dataset.dragging = 'true';
    node.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    node.scrollLeft = drag.left - (e.clientX - drag.x);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    delete node.dataset.dragging; // snapping comes back on and settles the row on a card
    hold();
    onScroll();
  };

  const timer = setInterval(() => {
    if (hovering || drag || document.hidden || Date.now() < holdUntil) return;
    if (node.matches(':focus-within')) return;
    node.scrollBy({ left: dir() * step(), behavior: 'smooth' });
  }, interval);

  const passive = { passive: true } as const;
  node.addEventListener('scroll', onScroll, passive);
  node.addEventListener('wheel', hold, passive);
  node.addEventListener('touchstart', hold, passive);
  node.addEventListener('keydown', hold);
  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);
  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerUp);

  return {
    destroy() {
      clearInterval(timer);
      clearTimeout(settle);
      node.removeEventListener('scroll', onScroll);
      node.removeEventListener('wheel', hold);
      node.removeEventListener('touchstart', hold);
      node.removeEventListener('keydown', hold);
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
      delete node.dataset.enhanced;
    },
  };
}
