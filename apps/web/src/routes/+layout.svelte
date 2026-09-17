<script lang="ts">
import '../app.css';
import { onMount, setContext } from 'svelte';
import { initLazy } from '$lib/actions/lazy';
import ScrollTop from '$lib/components/ScrollTop.svelte';
import Toaster from '$lib/components/ui/Toaster.svelte';
import { provideI18n } from '$lib/i18n';
import type { LayoutData } from './$types';

/**
 * Root shell: loads the token stylesheet and exposes the active theme to components
 * (`<Icon>` reads the icon set from here). Shell LAYOUTS (sidebar, top nav, …) are resolved per
 * page kind and variant in the (app) / auth / public layouts (M2 S2), not here.
 *
 * It also starts the one lazy-load observer for the whole app, so `class="lazy"` works in any
 * page of any module without that module importing anything — see `$lib/actions/lazy.ts`. Images
 * do not need it: `<Img>` (and plain `loading="lazy"`) is browser-level and needs no script.
 */
let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
// Getters keep the context live: a theme switch re-renders icons without a full reload.
setContext('ui-theme', {
  get id() {
    return data.theme.id;
  },
  get iconSet() {
    return data.theme.iconSet;
  },
  get mode() {
    return data.theme.mode;
  },
});
provideI18n({
  get locale() {
    return data.locale;
  },
  get messages() {
    return data.messages;
  },
});
// Client only, and once per document: the observers live for as long as the tab does.
onMount(() => initLazy());
</script>

<svelte:head>
  <meta name="color-scheme" content={data.theme.mode === 'dark' ? 'dark' : data.theme.mode === 'light' ? 'light' : 'light dark'} />
  {#if data.theme.faviconUrl}
    <link rel="icon" href={data.theme.faviconUrl} />
  {:else}
    <!-- Brand favicon (static/favicon.svg + PNG fallbacks from `bun run favicon:render`); a custom theme's favicon (assets.favicon) replaces it. -->
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  {/if}
</svelte:head>

{@render children()}
<ScrollTop />
<Toaster />
