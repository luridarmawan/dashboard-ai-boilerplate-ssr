/**
 * `@core/ui` (extension point 10): every core component from one alias, for modules and core
 * pages alike. Subpaths work too: `@core/ui/ui`, `@core/ui/form`, `@core/ui/table`,
 * `@core/ui/Icon.svelte`. Svelte components are re-exported individually, so unused ones are
 * tree-shaken from a page's bundle.
 */
export { default as Csrf } from './Csrf.svelte';
export * from './form/index.ts';
export { default as Icon } from './Icon.svelte';
export { default as SidebarToggle } from './SidebarToggle.svelte';
export * from './table/index.ts';
export * from './ui/index.ts';
