/**
 * `use:spotlight` — a highlight that glides to whichever link in the container is hovered or
 * focused (the top bar of the public header). One absolutely positioned element is moved with
 * a transform and resized, instead of each link drawing its own hover background, so the
 * highlight visibly travels between items and fades out when the pointer leaves the row.
 *
 * Progressive enhancement only: without JavaScript the links keep their own hover colour. With
 * `prefers-reduced-motion: reduce` the highlight jumps instead of sliding. The container must be
 * positioned (`relative`); links must sit above the highlight (`relative z-10`).
 *
 * Options: `selector` picks the items that attract the highlight (default every link), `tone`
 * its colour classes — pick one that differs from the row's background. While the action is
 * live the container carries `data-spotlit`, so items can drop their own hover background with
 * `in-data-[spotlit]:hover:bg-transparent` and keep it as the no-JavaScript fallback.
 */
export function spotlight(node: HTMLElement, opts: { selector?: string; tone?: string } = {}) {
  const selector = opts.selector ?? 'a';
  const light = document.createElement('span');
  light.setAttribute('aria-hidden', 'true');
  light.dataset.spotlight = '';
  light.className = `pointer-events-none absolute top-0 rounded-md opacity-0 ${opts.tone ?? 'bg-background shadow-sm'}`;
  // Measured from the physical left edge (getBoundingClientRect), so anchored there in RTL too.
  light.style.left = '0';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motion = () =>
    (light.style.transition = reduce.matches
      ? 'opacity 120ms'
      : 'transform 220ms cubic-bezier(.2,.8,.2,1), width 220ms cubic-bezier(.2,.8,.2,1), opacity 160ms');
  motion();
  node.prepend(light);
  node.dataset.spotlit = '';

  let shown = false;
  function moveTo(target: HTMLElement) {
    const box = node.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    // The first appearance places the light without sliding in from the row's start.
    if (!shown) light.style.transition = 'opacity 160ms';
    light.style.width = `${r.width}px`;
    light.style.height = `${r.height}px`;
    light.style.transform = `translate(${r.left - box.left}px, ${r.top - box.top}px)`;
    light.style.opacity = '1';
    if (!shown) {
      shown = true;
      requestAnimationFrame(motion);
    }
  }
  function hide() {
    light.style.opacity = '0';
    shown = false;
  }
  const pick = (e: Event) => (e.target as Element | null)?.closest<HTMLElement>(selector);
  const onOver = (e: Event) => {
    const t = pick(e);
    if (t && node.contains(t)) moveTo(t);
  };
  const onFocusOut = (e: FocusEvent) => {
    if (!node.contains(e.relatedTarget as Node | null)) hide();
  };
  node.addEventListener('pointerover', onOver);
  node.addEventListener('focusin', onOver);
  node.addEventListener('pointerleave', hide);
  node.addEventListener('focusout', onFocusOut);
  reduce.addEventListener('change', motion);
  return {
    destroy() {
      node.removeEventListener('pointerover', onOver);
      node.removeEventListener('focusin', onOver);
      node.removeEventListener('pointerleave', hide);
      node.removeEventListener('focusout', onFocusOut);
      reduce.removeEventListener('change', motion);
      light.remove();
      delete node.dataset.spotlit;
    },
  };
}
