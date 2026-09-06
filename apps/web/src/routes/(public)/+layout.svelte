<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';
import type { LayoutData } from './$types';

let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
const Layout = $derived(data.Layout);
const t = useT();
</script>

{#snippet brand()}
  <a href="/" class="flex items-center gap-2 text-lg font-semibold text-foreground no-underline hover:no-underline">
    <Icon name="sparkles" class="text-primary" /><span>{t('app.name')}</span>
  </a>
{/snippet}
{#snippet nav({ orientation }: { orientation: 'vertical' | 'horizontal' })}
  <ul class={orientation === 'horizontal' ? 'flex items-center gap-4 text-sm' : 'grid gap-1 text-sm'}>
    <li><a href="/theme" class="text-foreground no-underline hover:underline">{t('nav.theme')}</a></li>
    <li><a href="/lang" class="text-foreground no-underline hover:underline">{t('nav.language')}</a></li>
    {#if data.loggedIn}
      <li><a href="/dashboard" class="text-foreground no-underline hover:underline">{t('nav.dashboard')}</a></li>
    {:else}
      <li><a href="/auth/login" class="text-foreground no-underline hover:underline">{t('nav.login')}</a></li>
      <li><a href="/auth/register" class="text-foreground no-underline hover:underline">{t('nav.register')}</a></li>
    {/if}
  </ul>
{/snippet}
{#snippet content()}{@render children()}{/snippet}
{#snippet footer()}
  <p>{t('landing.lead')}</p>
{/snippet}

<Layout {brand} {nav} {content} {footer} />
