<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { forgetBrowserStorage } from '$lib/forget-browser';
import { useT } from '$lib/i18n';
import type { LayoutData } from './$types';

let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
const Layout = $derived(data.Layout);
const t = useT();
/** Branding (E-1): name from Pengaturan → Aplikasi; theme logo (L-24) wins over `app.logo_url`. */
const brandName = $derived(data.app.name || t('app.name'));
const brandLogo = $derived(data.theme.logoUrl ?? data.app.logoUrl);
/**
 * Developer-only "clear cache" (NODE_ENV=development), on the login page, right of "Language":
 * a plain POST to /auth/clear-cache expires every app cookie and sends Clear-Site-Data, and the
 * submit handler wipes Web Storage first for browsers that ignore the header. A tester switching
 * accounts starts from a truly clean browser without opening the devtools.
 */
const clearCache = $derived(data.devTools && page.route.id === '/auth/login');
</script>

{#snippet brand()}
  <a href="/" class="flex items-center gap-2 text-lg font-semibold text-foreground no-underline hover:no-underline">
    {#if brandLogo}<img src={brandLogo} alt="" class="h-8 w-auto max-w-40 object-contain" />{:else}<Icon name="sparkles" class="text-primary" />{/if}<span>{brandName}</span>
  </a>
{/snippet}
{#snippet content()}{@render children()}{/snippet}
{#snippet footer()}
  <span>© {t('shell.footer')} · <a href="/theme">{t('nav.theme')}</a> · <a href="/lang">{t('nav.language')}</a>{#if clearCache} · <form method="POST" action="/auth/clear-cache" class="inline" onsubmit={() => forgetBrowserStorage()}><button type="submit" class="cursor-pointer text-inherit underline-offset-2 hover:underline" data-testid="clear-cache">{t('auth.clear_cache')}</button></form>{/if}</span>
{/snippet}

<Layout {brand} {content} {footer} background={data.background} />
