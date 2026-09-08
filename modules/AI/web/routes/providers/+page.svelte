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

<svelte:head><title>{t('ai.providers.title')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('ai.providers.title')}</h1>
    {#if can('ai.provider.manage')}<Button href="/m/ai/providers/new" size="sm"><Icon name="plus" size={16} />{t('ai.providers.new')}</Button>{/if}
  </div>
  <p class="text-sm text-muted-foreground">{t('ai.providers.intro')}</p>
  {#if data.saved === 'deleted'}<p class="notice">{t('ai.providers.deleted')}</p>{/if}
  <Table caption={t('ai.providers.title')}>
    <thead><tr><th>Nama</th><th>Kode</th><th>Base URL</th><th>{t('ai.providers.models')}</th><th>{t('ai.providers.status')}</th><th></th></tr></thead>
    <tbody>
      {#each data.providers as p (p.id)}
        <tr data-testid="provider-row">
          <td class="font-medium">
            {p.name}
            {#if p.isDefault}<Badge variant="outline">{t('ai.providers.default')}</Badge>{/if}
            {#if !p.enabled}<Badge variant="secondary">{t('ai.providers.disabled')}</Badge>{/if}
          </td>
          <td><code>{p.code}</code></td>
          <td class="max-w-[22rem] truncate text-muted-foreground" title={p.baseUrl}>{p.baseUrl}{#if !p.apiKeySet} <Badge variant="destructive">{t('ai.providers.no_key')}</Badge>{/if}</td>
          <td>{p.models.length} <span class="text-xs text-muted-foreground">({p.defaultModel})</span></td>
          <td>
            {#if p.lastStatus === 'ok'}<Badge variant="success">ok</Badge>
            {:else if p.lastStatus === 'error'}<span title={p.lastError ?? ''}><Badge variant="destructive">error</Badge></span>
            {:else}<span class="text-muted-foreground">{t('ai.providers.never')}</span>{/if}
            <span class="ml-1 text-xs text-muted-foreground">{fmt(p.lastTestedAt)}</span>
          </td>
          <td class="text-right"><a href={`/m/ai/providers/${p.id}`}>{can('ai.provider.manage') ? t('common.edit') : t('common.view')}</a></td>
        </tr>
      {:else}
        <tr><td colspan="6" class="py-8 text-center text-muted-foreground">{t('ai.providers.empty')}</td></tr>
      {/each}
    </tbody>
  </Table>
</div>
