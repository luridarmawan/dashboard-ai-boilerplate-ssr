/**
 * Progressive enhancement for `<details>` used as a dropdown (top-nav groups, language picker,
 * the mobile menu). Without JavaScript a details element already opens and closes on its summary;
 * with JavaScript we add what a popover is expected to do — close on outside click and Escape,
 * close the other dropdowns when one opens, and close after a client-side navigation (SvelteKit
 * does not reload the page, so an open dropdown would otherwise stay open over the content).
 */
const ATTR = 'data-dropdown';

export function closeAllDropdowns(except?: Element | null): void {
  if (typeof document === 'undefined') return;
  for (const d of document.querySelectorAll<HTMLDetailsElement>(`details[${ATTR}]`)) {
    if (d !== except && d.open) d.open = false;
  }
}

/** `use:dropdown={enabled}` — pass false to leave a details alone (sidebar trees are not popovers). */
export function dropdown(node: HTMLDetailsElement, enabled = true) {
  let on = false;
  const onDocClick = (e: MouseEvent) => {
    if (node.open && !node.contains(e.target as Node)) node.open = false;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && node.open) {
      node.open = false;
      node.querySelector<HTMLElement>('summary')?.focus();
    }
  };
  const onToggle = () => {
    if (node.open) closeAllDropdowns(node);
  };
  const attach = () => {
    if (on) return;
    on = true;
    node.setAttribute(ATTR, '');
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    node.addEventListener('toggle', onToggle);
  };
  const detach = () => {
    if (!on) return;
    on = false;
    node.removeAttribute(ATTR);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    node.removeEventListener('toggle', onToggle);
  };
  if (enabled) attach();
  return {
    update(next: boolean) {
      if (next) attach();
      else detach();
    },
    destroy: detach,
  };
}
