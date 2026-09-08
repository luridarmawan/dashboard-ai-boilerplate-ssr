<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';
import type { LayoutData } from './$types';

let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
const Layout = $derived(data.Layout);
const t = useT();
/** Branding (E-1): name from Pengaturan → Aplikasi; theme logo (L-24) wins over `app.logo_url`. */
const brandName = $derived(data.app.name || t('app.name'));
const brandLogo = $derived(data.theme.logoUrl ?? data.app.logoUrl);
</script>

{#snippet brand()}
  <a href="/" class="flex items-center gap-2 text-lg font-semibold text-foreground no-underline hover:no-underline">
    {#if brandLogo}<img src={brandLogo} alt="" class="h-8 w-auto max-w-40 object-contain" />{:else}<Icon name="sparkles" class="text-primary" />{/if}<span>{brandName}</span>
  </a>
{/snippet}
{#snippet content()}{@render children()}{/snippet}
{#snippet footer()}
  <span>© {t('shell.footer')} · <a href="/theme">{t('nav.theme')}</a> · <a href="/lang">{t('nav.language')}</a></span>
{/snippet}

<Layout {brand} {content} {footer} />
