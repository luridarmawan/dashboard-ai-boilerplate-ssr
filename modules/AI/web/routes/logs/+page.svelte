<script lang="ts">
import { type ColumnDef, DataTable } from '$lib/components/table';
import { Badge } from '$lib/components/ui';
import { formatDateTime } from '$lib/format';
import { useT } from '$lib/i18n';

let { data } = $props();
const t = useT();
type Row = (typeof data.logs)[number];

const columns: ColumnDef<Row>[] = [
  {
    key: 'time',
    label: t('ai.logs.time'),
    class: 'whitespace-nowrap',
    value: (r) => formatDateTime(r.createdAt),
  },
  { key: 'user', label: t('ai.logs.user'), value: (r) => r.userName ?? '—' },
  { key: 'model', label: t('ai.logs.model') },
  {
    key: 'tokens',
    label: t('ai.logs.tokens'),
    align: 'right',
    value: (r) => `${r.tokensIn ?? '—'} / ${r.tokensOut ?? '—'}`,
  },
  { key: 'latency', label: t('ai.logs.latency'), align: 'right' },
  { key: 'status', label: t('ai.logs.status') },
  {
    key: 'cost',
    label: t('ai.logs.cost'),
    align: 'right',
    value: (r) => (r.costMicro === null ? '—' : (r.costMicro / 1_000_000).toFixed(4)),
  },
];
const filtered = $derived(
  !!(data.state.q || data.state.extra.model || data.state.extra.from || data.state.extra.to),
);
const inputClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm';
</script>

<svelte:head><title>{t('ai.logs.title')}</title></svelte:head>

<div class="page">
  <h1>{t('ai.logs.title')}</h1>
  <DataTable
    rows={data.logs}
    {columns}
    state={data.state}
    caption={t('ai.logs.title')}
    searchPlaceholder={t('ai.logs.search_user')}
    emptyTitle={t('common.none')}
    emptyHint={filtered ? t('ai.logs.empty_filtered') : ''}
  >
    {#snippet toolbar()}
      <a href="/m/ai/analytics" class="text-sm">{t('ai.analytics.title')} →</a>
    {/snippet}
    {#snippet filters()}
      <!-- Page filters: submit with the search box; the enhanced layer applies each on change. -->
      <label class="sr-only" for="ai-logs-model">{t('ai.logs.model')}</label>
      <select id="ai-logs-model" name="model" class={inputClass} data-testid="ai-logs-model">
        <option value="">{t('ai.logs.all_models')}</option>
        {#each data.models as m (m)}<option value={m} selected={data.state.extra.model === m}>{m}</option>{/each}
        {#if data.state.extra.model && !data.models.includes(data.state.extra.model)}<option value={data.state.extra.model} selected>{data.state.extra.model}</option>{/if}
      </select>
      <label class="flex items-center gap-1 text-sm text-muted-foreground">{t('ai.logs.from')}
        <input type="date" name="from" value={data.state.extra.from ?? ''} max={data.state.extra.to} class={inputClass} data-testid="ai-logs-from" />
      </label>
      <label class="flex items-center gap-1 text-sm text-muted-foreground">{t('ai.logs.to')}
        <input type="date" name="to" value={data.state.extra.to ?? ''} min={data.state.extra.from} class={inputClass} data-testid="ai-logs-to" />
      </label>
      {#if filtered}<a href="/m/ai/logs" class="text-sm">{t('ai.logs.reset')}</a>{/if}
    {/snippet}
    {#snippet cell(l, col)}
      {#if col.key === 'model'}
        {#if l.provider}<span class="text-xs text-muted-foreground">{l.provider} /</span> {/if}<code>{l.model ?? '—'}</code>{#if l.streamed} <Badge variant="outline">stream</Badge>{/if}
      {:else if col.key === 'latency'}
        {l.latencyMs ?? '—'} ms{#if l.firstTokenMs !== null} <span class="text-muted-foreground">(1st {l.firstTokenMs} ms)</span>{/if}
      {:else if col.key === 'status'}
        <Badge variant={l.status === 'ok' ? 'success' : l.status === 'cancelled' ? 'secondary' : 'destructive'}>{l.status}</Badge>{#if l.error} <span class="text-xs text-muted-foreground" title={l.error}>!</span>{/if}
      {:else}
        {col.value ? (col.value(l) ?? '—') : '—'}
      {/if}
    {/snippet}
  </DataTable>
</div>
