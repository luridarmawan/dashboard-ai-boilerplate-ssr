import type { Component } from 'svelte';
import type { AuthRegions, DashboardRegions, PublicRegions } from './types.ts';

/**
 * Layout id → lazy component (PRD L-6: code-split — only the layout a request resolves to is
 * downloaded). Built-ins live here; layouts contributed by modules (extension point 15) are
 * appended by `modules:sync` in the generated registry. Ids match packages/ui-theme/layouts/registry.json.
 */
// biome-ignore lint/suspicious/noExplicitAny: Svelte component prop constraint
type Loader<T extends Record<string, any>> = () => Promise<{ default: Component<T> }>;

export const dashboardLayouts: Record<string, Loader<DashboardRegions>> = {
  'sidebar-classic': () => import('./sidebar-classic/Layout.svelte'),
  'topnav-compact': () => import('./topnav-compact/Layout.svelte'),
  'centered-narrow': () => import('./centered-narrow/Layout.svelte'),
};
export const publicLayouts: Record<string, Loader<PublicRegions>> = {
  'marketing-wide': () => import('./marketing-wide/Layout.svelte'),
};
export const authLayouts: Record<string, Loader<AuthRegions>> = {
  'centered-card': () => import('./centered-card/Layout.svelte'),
  'split-hero': () => import('./split-hero/Layout.svelte'),
};
