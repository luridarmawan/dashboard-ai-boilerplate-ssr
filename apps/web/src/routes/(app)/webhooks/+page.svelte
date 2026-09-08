<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Table } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const t = useT();
const locale = useLocale();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID') : '—';
</script>

<svelte:head><title>{t('webhooks.title')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('webhooks.title')}</h1>
    {#if can('webhook.manage')}<Button href="/webhooks/new" size="sm"><Icon name="plus" size={16} />{t('webhooks.add')}</Button>{/if}
  </div>
  <p class="text-sm text-muted-foreground">{t('webhooks.lead')}</p>
  {#if data.saved === 'deleted'}<p class="notice">{t('webhooks.deleted')}</p>{/if}
  <Table caption={t('webhooks.title')}>
    <thead><tr><th>{t('webhooks.name')}</th><th>{t('webhooks.url')}</th><th>{t('webhooks.events')}</th><th>{t('webhooks.last_status')}</th><th></th></tr></thead>
    <tbody>
      {#each data.webhooks as w (w.id)}
        <tr data-testid="webhook-row">
          <td class="font-medium">{w.name}{#if !w.enabled} <Badge variant="secondary">{t('common.inactive')}</Badge>{/if}</td>
          <td class="max-w-[22rem] truncate text-muted-foreground" title={w.url}>{w.url}</td>
          <td>{#each w.events as e (e)}<code class="me-1">{e}</code>{/each}</td>
          <td>
            {#if w.lastStatus === 'ok'}<Badge variant="success">ok</Badge>
            {:else if w.lastStatus === 'error'}<span title={w.lastError ?? ''}><Badge variant="destructive">error</Badge></span>
            {:else}<span class="text-muted-foreground">{t('webhooks.no_delivery_yet')}</span>{/if}
            <span class="ms-1 text-xs text-muted-foreground">{fmt(w.lastDeliveredAt)}</span>
          </td>
          <td class="text-end"><a href={`/webhooks/${w.id}`}>{can('webhook.manage') ? t('webhooks.manage') : t('common.view')}</a></td>
        </tr>
      {:else}
        <tr><td colspan="5" class="py-8 text-center text-muted-foreground">{t('webhooks.empty')}</td></tr>
      {/each}
    </tbody>
  </Table>
</div>
