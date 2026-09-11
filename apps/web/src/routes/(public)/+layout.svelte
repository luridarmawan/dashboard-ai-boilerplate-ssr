<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import LanguagePicker from '$lib/components/LanguagePicker.svelte';
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
{#snippet nav({ orientation }: { orientation: 'vertical' | 'horizontal' })}
  <ul class={orientation === 'horizontal' ? 'flex items-center gap-4 text-sm' : 'grid gap-1 text-sm'}>
    <li><LanguagePicker current={data.locale} csrf={data.csrf} back={data.path} compact /></li>
    {#if data.loggedIn}
      <li><a href="/dashboard" class="text-foreground no-underline hover:underline">{t('nav.dashboard')}</a></li>
    {:else}
      <li><a href="/auth/login" class="text-foreground no-underline hover:underline">{t('nav.login')}</a></li>
      {#if data.signupEnabled}
        <li><a href="/auth/register" class="text-foreground no-underline hover:underline">{t('nav.register')}</a></li>
      {/if}
    {/if}
  </ul>
{/snippet}
{#snippet content()}{@render children()}{/snippet}
{#snippet footer()}
  <p>{t('landing.lead')}</p>
{/snippet}

<Layout {brand} {nav} {content} {footer} />
