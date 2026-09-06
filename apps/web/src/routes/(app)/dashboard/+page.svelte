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
</script>

<svelte:head><title>{t('nav.dashboard')}</title></svelte:head>

<div class="page">
  <h1>{t('dashboard.hello', { name: data.user.name })}</h1>
  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <Card title={t('dashboard.active_tenant')} class="md:col-span-2 xl:col-span-3">
      <div class="grid gap-2 text-sm sm:grid-cols-3">
        <p><span class="text-muted-foreground">{t('dashboard.email')}</span><br />{data.user.email}{#if data.user.isSuperadmin} · <code>superadmin</code>{/if}</p>
        <p><span class="text-muted-foreground">{t('dashboard.active_tenant')}</span><br />{data.tenants.find((x) => x.id === data.clientId)?.name ?? '—'}</p>
        <p><span class="text-muted-foreground">{t('dashboard.permissions')}</span><br />
          {#if data.permissions.length}{#each data.permissions as p (p)}<code class="mr-1">{p}</code>{/each}{:else}<span class="text-muted-foreground">{t('common.none')}</span>{/if}
        </p>
      </div>
    </Card>
    {#each data.widgets as w (w.id)}
      <Card title={w.title} description={w.module} class={span(w.size)}>
        {#if w.Component}
          <w.Component {context} />
        {/if}
      </Card>
    {:else}
      <p class="text-sm text-muted-foreground md:col-span-2 xl:col-span-3">{t('dashboard.widgets_soon')}</p>
    {/each}
  </div>
</div>
