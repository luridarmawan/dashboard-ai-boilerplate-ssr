<script lang="ts">
import { Badge, Table } from '$lib/components/ui';
import { useT } from '$lib/i18n';

let { data } = $props();
const t = useT();
</script>

<svelte:head><title>{t('ai.logs.title')}</title></svelte:head>

<div class="page">
  <h1>{t('ai.logs.title')}</h1>
  <Table caption={t('ai.logs.title')}>
    <thead><tr><th>Waktu</th><th>{t('ai.logs.model')}</th><th class="text-end">{t('ai.logs.tokens')}</th><th class="text-end">{t('ai.logs.latency')}</th><th>{t('ai.logs.status')}</th><th class="text-end">{t('ai.logs.cost')}</th></tr></thead>
    <tbody>
      {#each data.logs as l (l.id)}
        <tr>
          <td class="whitespace-nowrap text-muted-foreground">{new Date(l.createdAt).toLocaleString('id-ID')}</td>
          <td>{#if l.provider}<span class="text-xs text-muted-foreground">{l.provider} /</span> {/if}<code>{l.model ?? '—'}</code>{#if l.streamed} <Badge variant="outline">stream</Badge>{/if}</td>
          <td class="text-end">{l.tokensIn ?? '—'} / {l.tokensOut ?? '—'}</td>
          <td class="text-end">{l.latencyMs ?? '—'} ms{#if l.firstTokenMs !== null} <span class="text-muted-foreground">(1st {l.firstTokenMs} ms)</span>{/if}</td>
          <td><Badge variant={l.status === 'ok' ? 'success' : l.status === 'cancelled' ? 'secondary' : 'destructive'}>{l.status}</Badge>{#if l.error} <span class="text-xs text-muted-foreground" title={l.error}>!</span>{/if}</td>
          <td class="text-end">{l.costMicro === null ? '—' : (l.costMicro / 1_000_000).toFixed(4)}</td>
        </tr>
      {:else}
        <tr><td colspan="6" class="py-8 text-center text-muted-foreground">{t('common.none')}</td></tr>
      {/each}
    </tbody>
  </Table>
  <p class="text-sm text-muted-foreground">{data.meta.total} · {data.meta.page}/{data.meta.totalPages} · <a href="/m/ai/analytics">{t('ai.analytics.title')} →</a></p>
</div>
