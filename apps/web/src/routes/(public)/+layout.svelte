<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import LanguagePicker from '$lib/components/LanguagePicker.svelte';
import SiteMenu from '$lib/components/SiteMenu.svelte';
import { useT } from '$lib/i18n';
import type { LayoutData } from './$types';

let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
const Layout = $derived(data.Layout);
const t = useT();
/** Branding (E-1): name from Pengaturan → Aplikasi; theme logo (L-24) wins over `app.logo_url`. */
const brandName = $derived(data.app.name || t('app.name'));
const brandLogo = $derived(data.theme.logoUrl ?? data.app.logoUrl);
type HeaderWidget = LayoutData['headerWidgets'][number];
const widgetsIn = (slot: HeaderWidget['slot']) =>
  data.headerWidgets.filter(
    (w): w is HeaderWidget & { Component: NonNullable<HeaderWidget['Component']> } =>
      w.slot === slot && !!w.Component,
  );
const topbarWidgets = $derived(widgetsIn('public-topbar'));
const searchWidgets = $derived(widgetsIn('public-search'));
const actionWidgets = $derived(widgetsIn('public-actions'));
/** The top bar is drawn only when an admin filled it or a module put something in it. */
const hasTopbar = $derived(
  data.topbar.length > 0 || data.topbarEnd.length > 0 || topbarWidgets.length > 0,
);
/** What a header widget may know about the page — never the session itself. */
const widgetContext = $derived({
  locale: data.locale,
  path: data.path,
  csrf: data.csrf,
  loggedIn: data.loggedIn,
  appName: brandName,
});
</script>

{#snippet brand()}
  <a href="/" class="flex items-center gap-2 text-lg font-semibold text-foreground no-underline hover:no-underline">
    {#if brandLogo}<img src={brandLogo} alt="" class="h-8 w-auto max-w-40 object-contain" />{:else}<Icon name="sparkles" class="text-primary" />{/if}<span>{brandName}</span>
  </a>
{/snippet}
{#snippet language(orientation: 'vertical' | 'horizontal')}
  <!-- The vertical nav is the mobile menu: an inline submenu there, not a popover over the links. -->
  <LanguagePicker current={data.locale} csrf={data.csrf} back={data.path} compact={orientation === 'horizontal'} variant={orientation === 'vertical' ? 'submenu' : 'dropdown'} />
{/snippet}
{#snippet nav({ orientation }: { orientation: 'vertical' | 'horizontal' })}
  <ul class={orientation === 'horizontal' ? 'flex items-center gap-4 text-sm' : 'grid gap-1 text-sm'}>
    {#each data.navLinks as link (link.href)}
      <li><a href={link.href} aria-current={link.current ? 'page' : undefined} class="text-foreground no-underline hover:underline aria-[current=page]:font-semibold aria-[current=page]:text-primary">{link.label}</a></li>
    {/each}
    <!-- While the top bar is shown the language picker lives there; the mobile menu keeps its own. -->
    {#if !hasTopbar || orientation === 'vertical'}<li>{@render language(orientation)}</li>{/if}
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
{#snippet topbarItem(item: LayoutData['topbar'][number])}
  {#if item.href}
    <a href={item.href} class="inline-flex items-center gap-1.5 text-muted-foreground no-underline hover:text-foreground hover:underline" {...item.external ? { rel: 'noopener', target: '_blank' } : {}}>{#if item.icon}<Icon name={item.icon} size={14} />{/if}{item.label}</a>
  {:else}
    <span class="inline-flex items-center gap-1.5">{#if item.icon}<Icon name={item.icon} size={14} />{/if}{item.label}</span>
  {/if}
{/snippet}
{#snippet topbar()}
  <ul class="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto whitespace-nowrap">
    {#each data.topbar as item, i (`${i}:${item.label}`)}<li>{@render topbarItem(item)}</li>{/each}
  </ul>
  {#each topbarWidgets as w (w.id)}<w.Component context={widgetContext} data={w.data} />{/each}
  <!-- The right-hand group (contact, help): never scrolls away, a divider between items. -->
  {#if data.topbarEnd.length}
    <ul id="topbar-end" class="flex shrink-0 items-center divide-x divide-border whitespace-nowrap">
      {#each data.topbarEnd as item, i (`${i}:${item.label}`)}<li class="px-3 first:ps-0 last:pe-0">{@render topbarItem(item)}</li>{/each}
    </ul>
  {/if}
  <!-- Mobile keeps the picker in its menu; the top bar is too narrow there for a dropdown. -->
  <div class="hidden md:block">{@render language('horizontal')}</div>
{/snippet}
{#snippet search()}
  {#each searchWidgets as w (w.id)}<w.Component context={widgetContext} data={w.data} />{/each}
{/snippet}
{#snippet actions()}
  {#each actionWidgets as w (w.id)}<w.Component context={widgetContext} data={w.data} />{/each}
{/snippet}
{#snippet menubar({ orientation }: { orientation: 'vertical' | 'horizontal' })}
  <SiteMenu items={data.menubar} {orientation} />
{/snippet}
{#snippet content()}{@render children()}{/snippet}
{#snippet footer()}
  <p>{t('landing.lead')}</p>
{/snippet}

<!--
  The optional header regions are passed ONLY when they have something to show: that is the
  signal every public layout keys off, so none of them ever draws an empty row (see PublicRegions).
-->
<Layout
  {brand}
  {nav}
  {content}
  {footer}
  {...(hasTopbar ? { topbar } : {})}
  {...(searchWidgets.length ? { search } : {})}
  {...(actionWidgets.length ? { actions } : {})}
  {...(data.menubar.length ? { menubar } : {})}
/>
