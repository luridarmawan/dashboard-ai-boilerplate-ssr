/**
 * `use:railExpand` on the <nav> of a collapsed sidebar rail (F-8).
 *
 * A collapsed rail shows icons only, so a group has nowhere to put its children: opening one is
 * the reader asking for the full width back. Without JavaScript the layout's own CSS already
 * answers that — `#sidebar-rail:has(details[open])` widens the rail for as long as the group is
 * open — but the choice dies on the next navigation, because the server still has "collapsed".
 *
 * So with JavaScript we make it stick: submit the toggle form that is already on the page
 * (SidebarToggle), which flips `data-sidebar` and posts the preference exactly as a click on it
 * would. Nothing here invents behaviour the no-JavaScript layer lacks; it only makes it last.
 */
const TOGGLE_FORM = 'form[data-testid="sidebar-toggle-form"]';

export function railExpand(node: HTMLElement) {
  // `toggle` does not bubble, so listen in the capture phase on the nav itself.
  const onToggle = (event: Event) => {
    const details = event.target as HTMLDetailsElement | null;
    if (!details?.open || !node.contains(details)) return;
    if (document.documentElement.getAttribute('data-sidebar') !== 'collapsed') return;
    document.querySelector<HTMLFormElement>(TOGGLE_FORM)?.requestSubmit();
  };
  node.addEventListener('toggle', onToggle, true);
  return {
    destroy() {
      node.removeEventListener('toggle', onToggle, true);
    },
  };
}
