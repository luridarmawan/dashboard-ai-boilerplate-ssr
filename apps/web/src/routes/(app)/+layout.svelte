<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
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
</script>

{#snippet brand()}
  <a href="/dashboard" class="flex items-center gap-2 font-semibold text-foreground no-underline hover:no-underline">
    <Icon name="sparkles" class="text-primary" />
    <span>{t('app.name')}</span>
  </a>
{/snippet}

{#snippet nav({ orientation }: { orientation: 'vertical' | 'horizontal' })}
  <ul class={orientation === 'horizontal' ? 'flex items-center gap-1' : 'grid gap-0.5'}>
    {#each data.menu as item (item.id)}
      <li>
        <a
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-foreground no-underline hover:bg-accent hover:text-accent-foreground hover:no-underline aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground aria-[current=page]:font-medium"
        >
          <Icon name={item.icon} size={18} />
          <span>{item.label}</span>
          {#if item.badge !== undefined}<span class="ml-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{item.badge}</span>{/if}
        </a>
        {#if item.children.length && orientation === 'vertical'}
          <ul class="ml-6 grid gap-0.5 border-l pl-2">
            {#each item.children as c (c.id)}
              <li><a href={c.href} aria-current={c.active ? 'page' : undefined} class="block rounded-md px-2 py-1 text-sm text-foreground no-underline hover:bg-accent hover:no-underline aria-[current=page]:font-medium">{c.label}</a></li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet header()}
  {#if data.tenants.length > 1}
    <!-- Tenant switcher (B-4): a POST and a full server-side navigation; hidden for one tenant (B-5). -->
    <form method="POST" action="/auth/switch-tenant" class="flex items-center gap-1">
      <Csrf token={data.csrf} />
      <input type="hidden" name="back" value={data.path} />
      <label class="sr-only" for="tenant-switch">{t('shell.tenant')}</label>
      <select id="tenant-switch" name="clientId" class="h-8 rounded-md border border-input bg-background px-2 text-sm">
        {#each data.tenants as t (t.id)}
          <option value={t.id} selected={t.id === data.clientId}>{t.name}</option>
        {/each}
      </select>
      <Button type="submit" variant="outline" size="sm">{t('shell.switch_tenant')}</Button>
    </form>
  {:else if activeTenant}
    <span class="hidden text-sm text-muted-foreground sm:inline">{activeTenant.name}</span>
  {/if}
  <!-- Bell (J-4): a plain link, badge rendered server-side; the page marks items read via forms. -->
  <a href="/notifications" class="relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent" aria-label={data.unreadNotifications ? `${t('shell.notifications')} (${data.unreadNotifications})` : t('shell.notifications')} data-testid="bell">
    <Icon name="bell" size={18} />
    {#if data.unreadNotifications}<span class="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground" data-testid="bell-count">{data.unreadNotifications > 99 ? '99+' : data.unreadNotifications}</span>{/if}
  </a>
  <a href={`/theme?back=${encodeURIComponent(data.path)}`} class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent" aria-label={t('shell.theme_link')}><Icon name="palette" size={18} /></a>
  <a href={`/lang?back=${encodeURIComponent(data.path)}`} class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent" aria-label={t('nav.language')}><Icon name="language" size={18} /></a>
  <a href="/profile" class="hidden items-center gap-2 rounded-md px-2 py-1 text-sm no-underline hover:bg-accent hover:no-underline sm:flex">
    <Icon name="user" size={18} /><span>{data.user.name}</span>
  </a>
  <form method="POST" action="/auth/logout">
    <Csrf token={data.csrf} />
    <Button type="submit" variant="ghost" size="sm" aria-label={t('nav.logout')}><Icon name="logout" size={18} /><span class="hidden sm:inline">{t('nav.logout')}</span></Button>
  </form>
{/snippet}

{#snippet breadcrumb()}
  <nav aria-label="Breadcrumb">
    <ol class="flex flex-wrap items-center gap-1">
      {#each data.breadcrumb as c, i (c.href ?? c.label)}
        {#if i > 0}<li aria-hidden="true"><Icon name="chevron-right" size={14} /></li>{/if}
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
