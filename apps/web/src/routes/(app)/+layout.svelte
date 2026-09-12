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
 * the resolved theme layout ARRANGES them (§4.8). Pages render into `content`, and may name
 * side content for `aside` (`export const _aside` — resolved server-side, like the variant).
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
/** Bell rows carry an ISO timestamp; the shell shows it in the reader's own locale. */
const whenText = (iso: string) =>
  new Date(iso).toLocaleString(data.locale === 'en' ? 'en-US' : 'id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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

{#snippet navLink(item: MenuItem, sub: boolean, tip = false)}
  <a
    href={item.href}
    aria-current={item.active ? 'page' : undefined}
    title={tip ? item.label : undefined}
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

{#snippet nav({
  orientation,
  rail = false,
}: {
  orientation: 'vertical' | 'horizontal';
  rail?: boolean;
})}
  <!-- F-3: a short top level, then collapsible groups. <details> needs no JavaScript; a group holding
       the current page is rendered open. Horizontal (top-nav layouts): each group is a dropdown.
       In a COLLAPSED rail (F-8) the labels are only readable as tooltips, and no group is rendered
       open — an open group is what tells the layout's CSS the reader asked for the full width back,
       so it must mean "just clicked", not "you happen to be on a page inside it". -->
  <!-- `rail` is the layout speaking, so it is never stale; `railed` follows the data and is only
       used where a stale value is harmless (a group left open is closed by the toggle itself). -->
  {@const railed = rail && data.sidebarCollapsed}
  <ul class={orientation === 'horizontal' ? 'flex items-center gap-1' : 'grid gap-0.5'}>
    {#each data.menu as item (item.id)}
      <li>
        {#if item.kind === 'group'}
          <!-- vertical: a tree, open when it holds the current page; horizontal: a popover, never
               left open by the server — the active group is marked on its summary instead -->
          <details
            open={orientation === 'vertical' && item.active && !railed}
            class="group relative"
            data-testid={`nav-${item.id}`}
            use:dropdown={orientation === 'horizontal'}
          >
            <summary
              aria-current={item.active && orientation === 'horizontal' ? 'page' : undefined}
              title={rail ? item.label : undefined}
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
          {@render navLink(item, false, rail)}
          {#if item.children.length && orientation === 'vertical'}
            {@render navChildren(item.children, orientation)}
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet header()}
  <!-- Bell (J-4): the badge is still rendered server-side; the newest unread open in a <details>
       dropdown, the same no-JS pattern as the account menu (`use:dropdown` only adds outside-click
       and Escape closing). Every control inside is a form posting to the /notifications actions —
       opening a row marks it read and lands on its link — so the shell needs no JavaScript (L-22). -->
  <details class="group relative" data-testid="bell-menu" use:dropdown>
    <summary class="relative flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent" aria-label={data.unreadNotifications ? `${t('shell.notifications')} (${data.unreadNotifications})` : t('shell.notifications')} data-testid="bell">
      <Icon name="bell" size={18} />
      {#if data.unreadNotifications}<span class="absolute -top-0.5 -end-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground" data-testid="bell-count">{data.unreadNotifications > 99 ? '99+' : data.unreadNotifications}</span>{/if}
    </summary>
    <div id="bell-dropdown" class="absolute end-0 z-40 mt-1 w-72 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg sm:w-80">
      <div class="flex items-center justify-between gap-2 px-2 py-1.5">
        <p class="text-sm font-medium">{t('notifications.title')}</p>
        {#if data.unreadNotifications}
          <form method="POST" action="/notifications?/readAll">
            <Csrf token={data.csrf} />
            <button type="submit" class="text-xs text-muted-foreground hover:text-foreground">{t('notifications.mark_all')}</button>
          </form>
        {/if}
      </div>
      <ul class="grid gap-0.5 border-t pt-1" data-testid="bell-items">
        {#each data.recentNotifications as n (n.id)}
          <li>
            <!-- The action redirects to `link` when it is a local path, else back to the list. -->
            <form method="POST" action="/notifications?/read">
              <Csrf token={data.csrf} />
              <input type="hidden" name="id" value={n.id} />
              <input type="hidden" name="link" value={n.link ?? ''} />
              <button type="submit" class="grid w-full gap-0.5 rounded-md px-2 py-1.5 text-start hover:bg-accent">
                <span class="min-w-0 truncate text-sm font-medium">{n.title}</span>
                {#if n.body}<span class="min-w-0 truncate text-xs text-muted-foreground">{n.body}</span>{/if}
                <span class="text-xs text-muted-foreground">{whenText(n.createdAt)}</span>
              </button>
            </form>
          </li>
        {:else}
          <li class="px-2 py-6 text-center text-sm text-muted-foreground">{t('notifications.no_unread')}</li>
        {/each}
      </ul>
      <div class="mt-1 border-t pt-1">
        <a href="/notifications" class="flex items-center justify-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent hover:no-underline">{t('notifications.view_all')}<Icon name="arrow-right" size={14} class="rtl:rotate-180" /></a>
      </div>
    </div>
  </details>
  <!-- Account menu: the avatar + name open a <details> dropdown (no JavaScript needed; `use:dropdown`
       adds outside-click/Escape/after-navigation closing) with the profile, the theme picker, the language picker, and sign-out. -->
  <details id="account-menu" class="group relative" data-testid="account-menu" use:dropdown>
    <summary class={`flex h-8 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm hover:bg-accent ${data.impersonator ? 'ring-2 ring-destructive' : ''}`} aria-label={data.impersonator ? `${t('shell.account_menu')} — ${t('shell.impersonating', { name: data.user.name, admin: data.impersonator.name })}` : t('shell.account_menu')}>
      {#if data.user.avatarUrl}<img src={data.user.avatarUrl} alt="" class="h-6 w-6 rounded-full object-cover" />{:else}<Icon name="user" size={18} />{/if}
      {#if data.impersonator}
        <!-- Impersonation (D-6): the mark rides on the account menu, so it is top right on every
             page — the impersonated name in the alert colour, the way out one click inside. -->
        <span class="inline-flex items-center gap-1 rounded-md bg-destructive px-1.5 py-0.5 text-xs font-semibold text-destructive-foreground" title={t('shell.impersonating', { name: data.user.name, admin: data.impersonator.name })} data-testid="impersonation-badge">
          <Icon name="eye" size={14} />
          <span class="max-w-32 truncate">{data.user.name}</span>
        </span>
      {:else}
        <span class="hidden max-w-40 truncate sm:inline">{data.user.name}</span>
      {/if}
      <Icon name="chevron-down" size={14} class="transition-transform group-open:rotate-180" />
    </summary>
    <div id="user-menu-dropdown" class="absolute end-0 z-40 mt-1 w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
      {#if data.impersonator}
        <form method="POST" action="/auth/stop-impersonate" class="grid gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs" role="status" data-testid="impersonation-banner">
          <Csrf token={data.csrf} />
          <input type="hidden" name="back" value={`/users/${data.user.id}`} />
          <p class="flex items-start gap-1.5"><Icon name="eye" size={14} class="mt-0.5" /><span>{t('shell.impersonating', { name: data.user.name, admin: data.impersonator.name })}</span></p>
          <Button type="submit" variant="destructive" size="sm">{t('shell.impersonate_stop')}</Button>
        </form>
      {/if}
      <div class="flex items-center gap-3 px-2 py-2">
        {#if data.user.avatarUrl}<img src={data.user.avatarUrl} alt="" class="h-10 w-10 rounded-full object-cover" />{:else}<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon name="user" size={20} /></span>{/if}
        <div class="min-w-0"><p class={`truncate text-sm font-medium ${data.impersonator ? 'text-destructive' : ''}`}>{data.user.name}</p><p class="truncate text-xs text-muted-foreground">{data.user.email}</p>{#if activeTenant}<p class="truncate text-xs text-muted-foreground"><Icon name="building" size={12} class="me-1 inline align-[-1px]" />{activeTenant.name}</p>{/if}</div>
      </div>
      <ul class="grid gap-0.5 border-t pt-1">
        <li><a href="/profile" class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent hover:no-underline"><Icon name="user" size={16} class="text-muted-foreground" />{t('nav.profile')}</a></li>
        <li><a href={`/theme?back=${encodeURIComponent(data.path)}`} class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent hover:no-underline"><Icon name="palette" size={16} class="text-muted-foreground" />{t('shell.theme_link')}</a></li>
        <li>
          <LanguagePicker current={data.locale} csrf={data.csrf} back={data.path} variant="submenu" />
        </li>
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

{#snippet aside()}
  <!-- The page named this component; it reads the page's own load data through `page.data`. -->
  {#if data.Aside}<data.Aside />{/if}
{/snippet}

<!--
  `aside` is passed ONLY when the route named one, because that is the signal every layout
  keys off: a layout must collapse to a single column when there is no side content rather
  than draw an empty one (see the region contract in $lib/layouts/types.ts).
-->
<Layout {brand} {nav} {header} {breadcrumb} {content} {footer} {...(data.Aside ? { aside } : {})} />

<!-- Shell widgets (H-13): module contributions on every dashboard page, permission-filtered on the server. -->
{#each data.shellWidgets as w (w.id)}
  {#if w.Component}<w.Component context={shellContext} data={w.data} />{/if}
{/each}
