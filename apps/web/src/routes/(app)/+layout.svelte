<script lang="ts">
import { afterNavigate } from '$app/navigation';
import { closeAllDropdowns, dropdown } from '$lib/actions/dropdown';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import LanguagePicker from '$lib/components/LanguagePicker.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { MenuItem } from '$lib/server/menu';
import type { LayoutData } from './$types';

/**
 * The dashboard shell. Core fills the named regions (brand, nav, header, breadcrumb, footer) and
 * the resolved theme layout ARRANGES them (§4.8). Pages only ever render into `content`.
 * Every control here is a plain form or link — the shell works with JavaScript disabled (L-22).
 */
let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
const Layout = $derived(data.Layout);
const t = useT();
const activeTenant = $derived(data.tenants.find((t) => t.id === data.clientId));
/**
 * Branding (E-1): the name comes from Pengaturan → Aplikasi (the i18n key is only the fallback),
 * and the logo is the active theme's own asset when it has one (L-24), else `app.logo_url`.
 */
const brandName = $derived(data.app.name || t('app.name'));
const brandLogo = $derived(data.theme.logoUrl ?? data.app.logoUrl);
// Client-side navigation keeps the DOM: a top-nav group or the language dropdown left open would
// stay open over the new page. Without JavaScript every navigation is a full load and this never runs.
afterNavigate(() => closeAllDropdowns());
/** What a shell widget (H-13) learns about the page it floats over — nothing it could not see itself. */
const shellContext = $derived({
  locale: data.locale,
  clientId: data.clientId,
  permissions: data.permissions,
  csrf: data.csrf,
  path: data.path,
  breadcrumb: data.breadcrumb.map((c) => c.label),
  appName: brandName,
});
</script>

{#snippet brand()}
  <a href="/dashboard" class="flex items-center gap-2 font-semibold text-foreground no-underline hover:no-underline">
    {#if brandLogo}<img src={brandLogo} alt="" class="h-7 w-auto max-w-32 object-contain" />{:else}<Icon name="sparkles" class="text-primary" />{/if}
    <span>{brandName}</span>
  </a>
{/snippet}

{#snippet navLink(item: MenuItem, sub: boolean)}
  <a
    href={item.href}
    aria-current={item.active ? 'page' : undefined}
    class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-foreground no-underline hover:bg-accent hover:text-accent-foreground hover:no-underline aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground aria-[current=page]:font-medium"
  >
    <Icon name={item.icon} size={sub ? 16 : 18} class={sub ? 'text-muted-foreground' : ''} />
    <span>{item.label}</span>
    {#if item.badge !== undefined}<span class="ms-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{item.badge}</span>{/if}
  </a>
{/snippet}

{#snippet navChildren(list: MenuItem[], orientation: 'vertical' | 'horizontal')}
  <ul class={orientation === 'horizontal' ? 'grid min-w-56 gap-0.5' : 'ms-3 mt-0.5 grid gap-0.5 border-s ps-2'}>
    {#each list as c (c.id)}
      <li>
        {@render navLink(c, true)}
        {#if c.children.length}
          <ul class="ms-6 grid gap-0.5 border-s ps-2">
            {#each c.children as g (g.id)}<li>{@render navLink(g, true)}</li>{/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet nav({ orientation }: { orientation: 'vertical' | 'horizontal' })}
  <!-- F-3: a short top level, then collapsible groups. <details> needs no JavaScript; a group holding
       the current page is rendered open. Horizontal (top-nav layouts): each group is a dropdown. -->
  <ul class={orientation === 'horizontal' ? 'flex items-center gap-1' : 'grid gap-0.5'}>
    {#each data.menu as item (item.id)}
      <li>
        {#if item.kind === 'group'}
          <!-- vertical: a tree, open when it holds the current page; horizontal: a popover, never
               left open by the server — the active group is marked on its summary instead -->
          <details
            open={orientation === 'vertical' && item.active}
            class="group relative"
            data-testid={`nav-${item.id}`}
            use:dropdown={orientation === 'horizontal'}
          >
            <summary
              aria-current={item.active && orientation === 'horizontal' ? 'page' : undefined}
              class="flex cursor-pointer list-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-foreground hover:bg-accent hover:text-accent-foreground aria-[current=page]:font-medium"
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              <Icon name="chevron-down" size={14} class="ms-auto transition-transform group-open:rotate-180" />
            </summary>
            {#if orientation === 'horizontal'}
              <div class="absolute start-0 top-full z-40 mt-1 rounded-md border bg-popover p-1 shadow-lg">
                {@render navChildren(item.children, orientation)}
              </div>
            {:else}
              {@render navChildren(item.children, orientation)}
            {/if}
          </details>
        {:else}
          {@render navLink(item, false)}
          {#if item.children.length && orientation === 'vertical'}
            {@render navChildren(item.children, orientation)}
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet header()}
  {#if data.impersonator}
    <!-- Impersonation (D-6): unmistakable, on every page, with the way out. -->
    <form method="POST" action="/auth/stop-impersonate" class="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs" role="status" data-testid="impersonation-banner">
      <Csrf token={data.csrf} />
      <input type="hidden" name="back" value={`/users/${data.user.id}`} />
      <Icon name="eye" size={14} />
      <span>{t('shell.impersonating', { name: data.user.name, admin: data.impersonator.name })}</span>
      <Button type="submit" variant="destructive" size="sm">{t('shell.impersonate_stop')}</Button>
    </form>
  {/if}
  <!-- Bell (J-4): a plain link, badge rendered server-side; the page marks items read via forms. -->
  <a href="/notifications" class="relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent" aria-label={data.unreadNotifications ? `${t('shell.notifications')} (${data.unreadNotifications})` : t('shell.notifications')} data-testid="bell">
    <Icon name="bell" size={18} />
    {#if data.unreadNotifications}<span class="absolute -top-0.5 -end-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground" data-testid="bell-count">{data.unreadNotifications > 99 ? '99+' : data.unreadNotifications}</span>{/if}
  </a>
  <LanguagePicker current={data.locale} csrf={data.csrf} back={data.path} compact />
  <!-- Account menu: the avatar + name open a <details> dropdown (no JavaScript needed; `use:dropdown`
       adds outside-click/Escape/after-navigation closing) with the profile, the theme picker and sign-out. -->
  <details class="group relative" data-testid="account-menu" use:dropdown>
    <summary class="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm hover:bg-accent" aria-label={t('shell.account_menu')}>
      {#if data.user.avatarUrl}<img src={data.user.avatarUrl} alt="" class="h-6 w-6 rounded-full object-cover" />{:else}<Icon name="user" size={18} />{/if}
      <span class="hidden max-w-40 truncate sm:inline">{data.user.name}</span>
      <Icon name="chevron-down" size={14} class="transition-transform group-open:rotate-180" />
    </summary>
    <div id="user-menu-dropdown" class="absolute end-0 z-40 mt-1 w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
      <div class="flex items-center gap-3 px-2 py-2">
        {#if data.user.avatarUrl}<img src={data.user.avatarUrl} alt="" class="h-10 w-10 rounded-full object-cover" />{:else}<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon name="user" size={20} /></span>{/if}
        <div class="min-w-0"><p class="truncate text-sm font-medium">{data.user.name}</p><p class="truncate text-xs text-muted-foreground">{data.user.email}</p>{#if activeTenant}<p class="truncate text-xs text-muted-foreground"><Icon name="building" size={12} class="me-1 inline align-[-1px]" />{activeTenant.name}</p>{/if}</div>
      </div>
      <ul class="grid gap-0.5 border-t pt-1">
        <li><a href="/profile" class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent hover:no-underline"><Icon name="user" size={16} class="text-muted-foreground" />{t('nav.profile')}</a></li>
        <li><a href={`/theme?back=${encodeURIComponent(data.path)}`} class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent hover:no-underline"><Icon name="palette" size={16} class="text-muted-foreground" />{t('shell.theme_link')}</a></li>
        {#if data.tenants.length > 1}
          <!-- Tenant switcher (B-4) as a sub-menu: each tenant is a POST + full server-side navigation. Hidden for one tenant (B-5). -->
          <li>
            <details class="group/tenant" data-testid="tenant-switch">
              <summary class="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent">
                <Icon name="switch" size={16} class="text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate">{t('shell.switch_tenant_menu')}<span class="block truncate text-xs text-muted-foreground">{activeTenant?.name ?? '—'}</span></span>
                <Icon name="chevron-down" size={14} class="transition-transform group-open/tenant:rotate-180" />
              </summary>
              <form method="POST" action="/auth/switch-tenant" class="ms-6 mt-0.5 grid gap-0.5 border-s ps-2">
                <Csrf token={data.csrf} />
                <input type="hidden" name="back" value={data.path} />
                {#each data.tenants as tenant (tenant.id)}
                  <button type="submit" name="clientId" value={tenant.id} aria-current={tenant.id === data.clientId ? 'true' : undefined} class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-foreground hover:bg-accent aria-[current=true]:bg-accent aria-[current=true]:font-medium">
                    <Icon name="building" size={14} class="text-muted-foreground" /><span class="min-w-0 flex-1 truncate">{tenant.name}</span>
                    {#if tenant.id === data.clientId}<Icon name="check" size={14} />{/if}
                  </button>
                {/each}
              </form>
            </details>
          </li>
        {/if}
      </ul>
      <form method="POST" action="/auth/logout" class="mt-1 border-t pt-1">
        <Csrf token={data.csrf} />
        <button type="submit" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-destructive hover:bg-accent"><Icon name="logout" size={16} />{t('nav.logout')}</button>
      </form>
    </div>
  </details>
{/snippet}

{#snippet breadcrumb()}
  <nav aria-label="Breadcrumb">
    <ol class="flex flex-wrap items-center gap-1">
      {#each data.breadcrumb as c, i (c.href ?? c.label)}
        {#if i > 0}<li aria-hidden="true"><Icon name="chevron-right" size={14} class="rtl:rotate-180" /></li>{/if}
        <li>
          {#if c.href}<a href={c.href} class="text-muted-foreground hover:text-foreground">{c.label}</a>{:else}<span aria-current="page" class="text-foreground">{c.label}</span>{/if}
        </li>
      {/each}
    </ol>
  </nav>
{/snippet}

{#snippet content()}
  {#if data.tenantError}<p class="error mb-4">{t('shell.tenant_error')}</p>{/if}
  {@render children()}
{/snippet}

{#snippet footer()}
  <span>{t('shell.footer')} · tema <code>{data.theme.id}</code> · layout <code>{data.layoutId}</code>{#if data.layoutVariant !== 'default'} · varian <code>{data.layoutVariant}</code>{/if}</span>
{/snippet}

<Layout {brand} {nav} {header} {breadcrumb} {content} {footer} />

<!-- Shell widgets (H-13): module contributions on every dashboard page, permission-filtered on the server. -->
{#each data.shellWidgets as w (w.id)}
  {#if w.Component}<w.Component context={shellContext} data={w.data} />{/if}
{/each}
