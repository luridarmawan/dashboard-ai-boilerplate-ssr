import type { Snippet } from 'svelte';

/**
 * The layout contract (PRD §4.8, L-6, L-8). A layout is a Svelte component that ARRANGES named
 * regions and does nothing else: no data fetching (everything arrives as snippets/props from the
 * core shell), no knowledge of modules (it receives a rendered nav, not a menu to build).
 * Region lists per kind live in packages/ui-theme/layouts/registry.json; `scripts/ci/layout-contract.ts`
 * fails the build when a layout does not render every region its kind requires.
 */
export type NavOrientation = 'vertical' | 'horizontal';

export interface DashboardRegions {
  brand: Snippet;
  nav: Snippet<[{ orientation: NavOrientation }]>;
  header: Snippet;
  breadcrumb: Snippet;
  content: Snippet;
  /** Optional side content (filters, help). A layout must render it when provided. */
  aside?: Snippet;
  footer: Snippet;
}

export interface PublicRegions {
  brand: Snippet;
  nav: Snippet<[{ orientation: NavOrientation }]>;
  content: Snippet;
  footer: Snippet;
}

export interface AuthRegions {
  brand: Snippet;
  content: Snippet;
  footer: Snippet;
}
