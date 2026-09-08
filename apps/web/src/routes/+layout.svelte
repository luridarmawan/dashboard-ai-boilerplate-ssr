<script lang="ts">
import '../app.css';
import { setContext } from 'svelte';
import Toaster from '$lib/components/ui/Toaster.svelte';
import { provideI18n } from '$lib/i18n';
import type { LayoutData } from './$types';

/**
 * Root shell: loads the token stylesheet and exposes the active theme to components
 * (`<Icon>` reads the icon set from here). Shell LAYOUTS (sidebar, top nav, …) are resolved per
 * page kind and variant in the (app) / auth / public layouts (M2 S2), not here.
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
</script>

<svelte:head>
  <meta name="color-scheme" content={data.theme.mode === 'dark' ? 'dark' : data.theme.mode === 'light' ? 'light' : 'light dark'} />
  {#if data.theme.faviconUrl}<link rel="icon" href={data.theme.faviconUrl} />{/if}
</svelte:head>

{@render children()}
<Toaster />
