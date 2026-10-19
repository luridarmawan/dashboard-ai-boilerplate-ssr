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
  /**
   * `rail: true` says this nav IS the collapsible sidebar rail (F-8), not a menu that happens to
   * be vertical: only then does the shell drop the labels to tooltips and stop pre-opening the
   * active group — a mobile dropdown in the same layout must keep both. Optional, so layouts
   * written before F-8 (module ones included) keep compiling and keep their old behaviour.
   */
  nav: Snippet<[{ orientation: NavOrientation; rail?: boolean }]>;
  header: Snippet;
  breadcrumb: Snippet;
  content: Snippet;
  /** Optional side content (filters, help). A layout must render it when provided. */
  aside?: Snippet;
  footer: Snippet;
}

/**
 * The public site header is up to three rows: `topbar` (thin, above), the main row (`brand`,
 * `search`, `nav`, `actions`) and `menubar` (below, nested submenus). The four optional regions
 * are passed ONLY when they have something to show — an admin filled the row, an enabled module
 * contributed a widget — so a layout keys off their presence and never draws an empty row or an
 * empty search slot. A layout must still render each of them when given (L-8).
 */
export interface PublicRegions {
  brand: Snippet;
  nav: Snippet<[{ orientation: NavOrientation }]>;
  topbar?: Snippet;
  search?: Snippet;
  /** Icons at the end of the main row (a cart); they stay visible when the nav collapses. */
  actions?: Snippet;
  menubar?: Snippet<[{ orientation: NavOrientation }]>;
  content: Snippet;
  footer: Snippet;
}

export interface AuthRegions {
  brand: Snippet;
  content: Snippet;
  footer: Snippet;
  /**
   * Decorative backdrop for layouts that HAVE a brand panel (`split-hero`), from
   * `LOGIN_PAGE_BACKGROUND` in `.env`. A layout without such a panel ignores it, exactly as
   * `centered-card` does — the value arrives from the shell like every other prop, because a
   * layout never reads the environment itself.
   */
  background?: string | null;
}
