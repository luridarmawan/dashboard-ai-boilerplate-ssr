import type { Component } from 'svelte';

/**
 * Aside id → lazy component: the side content a page asks the shell to put in the layout's
 * `aside` region (PRD §4.8, L-6). Code-split exactly like the layouts — only the aside the
 * current route names is downloaded.
 *
 * Why a registry and not a snippet: the shell renders BEFORE the page it wraps, so a page
 * cannot hand it markup. It names an aside in `+page.server.ts` / `+page.ts`
 * (`export const _aside = '<id>'`, collected by `bun run layout:variants`), and the shell
 * resolves that name here — which is the same trade the layout variant already makes.
 *
 * An aside component takes no props: it reads the page's own `load` data through
 * `page.data` (`$app/state`), so the page stays the single source of its content.
 */
export type AsideLoader = () => Promise<{ default: Component<Record<string, never>> }>;

export const asides: Record<string, AsideLoader> = {
  'examples.aside': () => import('./examples/Aside.svelte'),
};
