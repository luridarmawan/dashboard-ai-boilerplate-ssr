import type { Component } from 'svelte';
import {
  moduleAuthLayouts,
  moduleDashboardLayouts,
  modulePublicLayouts,
} from '$lib/../generated/layouts';
import type { AuthRegions, DashboardRegions, PublicRegions } from './types.ts';

/**
 * Layout id → lazy component (PRD L-6: code-split — only the layout a request resolves to is
 * downloaded). Built-ins first; layouts contributed by modules (extension point 15, L-7) are
 * merged from the registry `modules:sync` generates. Ids match @core/ui-theme's registry.
 */
// biome-ignore lint/suspicious/noExplicitAny: Svelte component prop constraint
type Loader<T extends Record<string, any>> = () => Promise<{ default: Component<T> }>;

export const dashboardLayouts: Record<string, Loader<DashboardRegions>> = {
  'sidebar-classic': () => import('./sidebar-classic/Layout.svelte'),
  'topnav-compact': () => import('./topnav-compact/Layout.svelte'),
  'centered-narrow': () => import('./centered-narrow/Layout.svelte'),
  ...(moduleDashboardLayouts as Record<string, Loader<DashboardRegions>>),
};
export const publicLayouts: Record<string, Loader<PublicRegions>> = {
  'marketing-wide': () => import('./marketing-wide/Layout.svelte'),
  ...(modulePublicLayouts as Record<string, Loader<PublicRegions>>),
};
export const authLayouts: Record<string, Loader<AuthRegions>> = {
  'centered-card': () => import('./centered-card/Layout.svelte'),
  'split-hero': () => import('./split-hero/Layout.svelte'),
  ...(moduleAuthLayouts as Record<string, Loader<AuthRegions>>),
};
