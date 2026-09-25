<script lang="ts">
import { Card } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const t = useT();
const span = (size: string) =>
  size === 'lg' ? 'md:col-span-2 xl:col-span-3' : size === 'md' ? 'md:col-span-2' : '';
const context = $derived({
  locale: data.locale,
  clientId: data.clientId,
  permissions: data.permissions,
});
// Sorted copy so related permissions (same module prefix) sit next to each other.
const permissions = $derived([...data.permissions].sort());
</script>

<svelte:head><title>{t('nav.dashboard')}</title></svelte:head>

<div class="page">
  <h1>{t('dashboard.hello', { name: data.user.name })}</h1>
  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <Card title={t('dashboard.active_tenant')} class="md:col-span-2 xl:col-span-3">
      <div class="grid gap-2 text-sm sm:grid-cols-2">
        <p><span class="text-muted-foreground">{t('dashboard.email')}</span><br />{data.user.email}{#if data.user.isSuperadmin} · <code>superadmin</code>{/if}</p>
        <p><span class="text-muted-foreground">{t('dashboard.active_tenant')}</span><br />{data.tenants.find((x) => x.id === data.clientId)?.name ?? '—'}</p>
      </div>
    </Card>
    {#each data.widgets as w (w.id)}
      <Card title={w.title} description={w.module} class={span(w.size)}>
        {#if w.Component}
          <w.Component {context} data={w.data} />
        {/if}
      </Card>
    {:else}
      <p class="text-sm text-muted-foreground md:col-span-2 xl:col-span-3">{t('dashboard.widgets_soon')}</p>
    {/each}
  </div>

  <!-- Effective permissions are a developer aid (NODE_ENV=development only, decided on the
       server). They sit in their own section below the widgets: some accounts hold dozens of
       them, so they render as wrapping chips instead of one unbroken inline run. -->
  {#if data.showPermissions}
    <Card
      id="effective-permissions"
      title={t('dashboard.permissions')}
      description={t('dashboard.permissions_count', { count: permissions.length })}
      class="mt-4"
    >
      {#if permissions.length}
        <ul class="flex flex-wrap gap-1.5 text-xs">
          {#each permissions as p (p)}
            <li><code class="inline-block rounded border bg-muted px-1.5 py-0.5 break-all">{p}</code></li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-muted-foreground">{t('common.none')}</p>
      {/if}
    </Card>
  {/if}
</div>
