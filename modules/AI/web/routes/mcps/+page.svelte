<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Table } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';

let { data } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID') : '—');
</script>

<svelte:head><title>{t('ai.mcps.title')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('ai.mcps.title')}</h1>
    {#if can('ai.mcp.manage')}<Button href="/m/ai/mcps/new" size="sm"><Icon name="plus" size={16} />{t('ai.mcps.new')}</Button>{/if}
  </div>
  <p class="text-sm text-muted-foreground">{t('ai.mcps.intro')}</p>
  {#if data.saved === 'deleted'}<p class="notice">{t('ai.mcps.deleted')}</p>{/if}
  <Table caption={t('ai.mcps.title')}>
    <thead><tr><th>Nama</th><th>Kode</th><th>URL</th><th>{t('ai.mcps.tools')}</th><th>{t('ai.mcps.status')}</th><th></th></tr></thead>
    <tbody>
      {#each data.mcps as m (m.id)}
        <tr data-testid="mcp-row">
          <td class="font-medium">{m.name}{#if !m.enabled} <Badge variant="secondary">{t('ai.mcps.disabled')}</Badge>{/if}</td>
          <td><code>{m.code}</code></td>
          <td class="max-w-[24rem] truncate text-muted-foreground" title={m.url}><code>{m.transport}</code> {m.url}</td>
          <td>{m.toolsCount}</td>
          <td>
            {#if m.lastStatus === 'ok'}<Badge variant="success">ok</Badge>
            {:else if m.lastStatus === 'error'}<span title={m.lastError ?? ''}><Badge variant="destructive">error</Badge></span>
            {:else}<span class="text-muted-foreground">{t('ai.mcps.never')}</span>{/if}
            <span class="ml-1 text-xs text-muted-foreground">{fmt(m.lastSyncedAt)}</span>
          </td>
          <td class="text-right"><a href={`/m/ai/mcps/${m.id}`}>{can('ai.mcp.manage') ? t('common.edit') : t('common.view')}</a></td>
        </tr>
      {:else}
        <tr><td colspan="6" class="py-8 text-center text-muted-foreground">{t('ai.mcps.empty')}</td></tr>
      {/each}
    </tbody>
  </Table>
</div>
