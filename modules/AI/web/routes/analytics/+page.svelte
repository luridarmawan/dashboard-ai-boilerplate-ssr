<script lang="ts">
import { Badge, Card, Table } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/**
 * Usage analytics (H-15). Server-rendered, no chart library: the per-day series is a CSS bar
 * chart whose bars scale to the busiest day, so the page works without JavaScript like the rest.
 */
let { data } = $props();
const t = useT();
const s = $derived(data.stats);
const money = (micro: number) =>
  micro ? (micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2) : '—';
const num = (n: number) => n.toLocaleString('id-ID');
const maxTokens = $derived(
  Math.max(
    1,
    ...s.byDay.map((d: { tokensIn: number; tokensOut: number }) => d.tokensIn + d.tokensOut),
  ),
);
const pct = (n: number) => `${Math.max(n > 0 ? 2 : 0, Math.round((n / maxTokens) * 100))}%`;
const dayLabel = (day: string) => day.slice(5).replace('-', '/');
</script>

<svelte:head><title>{t('ai.analytics.title')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('ai.analytics.title')}</h1>
    <nav class="inline-flex rounded-lg bg-muted p-1 text-sm" aria-label={t('ai.analytics.period')}>
      {#each ['7', '30', '90'] as d (d)}
        <a href={`/m/ai/analytics?days=${d}`} class={`rounded-md px-3 py-1 no-underline ${data.days === d ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground'}`} aria-current={data.days === d ? 'page' : undefined}>{d} {t('ai.analytics.days')}</a>
      {/each}
    </nav>
  </div>
  <p class="text-sm text-muted-foreground">{t('ai.analytics.intro')} <a href="/m/ai/logs">{t('ai.logs.title')} →</a></p>
  {#if s.truncated}<p class="notice">{t('ai.analytics.truncated')}</p>{/if}

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="ai-analytics-totals">
    <Card><p class="text-xs text-muted-foreground">{t('ai.analytics.calls')}</p><p class="text-2xl font-semibold">{num(s.totals.calls)}</p><p class="text-xs text-muted-foreground">{num(s.totals.ok)} ok · {num(s.totals.errors)} {t('ai.analytics.errors')} · {num(s.totals.cancelled)} {t('ai.analytics.cancelled')}</p></Card>
    <Card><p class="text-xs text-muted-foreground">{t('ai.analytics.tokens_in')}</p><p class="text-2xl font-semibold">{num(s.totals.tokensIn)}</p></Card>
    <Card><p class="text-xs text-muted-foreground">{t('ai.analytics.tokens_out')}</p><p class="text-2xl font-semibold">{num(s.totals.tokensOut)}</p></Card>
    <Card><p class="text-xs text-muted-foreground">{t('ai.analytics.cost')}</p><p class="text-2xl font-semibold">{money(s.totals.costMicro)}</p><p class="text-xs text-muted-foreground">{t('ai.analytics.cost_hint')}</p></Card>
  </div>

  <Card title={t('ai.analytics.per_day')}>
    <div class="flex h-40 items-end gap-px overflow-x-auto" role="img" aria-label={t('ai.analytics.per_day')} data-testid="ai-analytics-chart">
      {#each s.byDay as d (d.day)}
        <div class="group relative flex min-w-[6px] flex-1 flex-col justify-end" style={`height:100%`} title={`${d.day}: ${num(d.tokensIn + d.tokensOut)} token · ${num(d.calls)} panggilan · ${money(d.costMicro)}`}>
          <div class="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={`height:${pct(d.tokensIn + d.tokensOut)}`}></div>
        </div>
      {/each}
    </div>
    <div class="mt-1 flex justify-between text-xs text-muted-foreground"><span>{dayLabel(s.byDay[0]?.day ?? '')}</span><span>{dayLabel(s.byDay.at(-1)?.day ?? '')}</span></div>
  </Card>

  <div class="grid gap-4 xl:grid-cols-2">
    <Card title={t('ai.analytics.per_model')}>
      <Table caption={t('ai.analytics.per_model')}>
        <thead><tr><th>{t('ai.analytics.provider')}</th><th>Model</th><th class="text-right">{t('ai.analytics.calls')}</th><th class="text-right">Token</th><th class="text-right">{t('ai.analytics.cost')}</th></tr></thead>
        <tbody>
          {#each s.byModel as m (`${m.provider}|${m.model}`)}
            <tr><td>{#if m.provider}<code>{m.provider}</code>{:else}<Badge variant="secondary">{t('ai.analytics.legacy')}</Badge>{/if}</td><td><code>{m.model ?? '—'}</code></td><td class="text-right">{num(m.calls)}</td><td class="text-right">{num(m.tokensIn + m.tokensOut)}</td><td class="text-right">{money(m.costMicro)}</td></tr>
          {:else}
            <tr><td colspan="5" class="py-6 text-center text-muted-foreground">{t('common.none')}</td></tr>
          {/each}
        </tbody>
      </Table>
    </Card>
    <Card title={t('ai.analytics.per_user')}>
      <Table caption={t('ai.analytics.per_user')}>
        <thead><tr><th>{t('ai.analytics.user')}</th><th class="text-right">{t('ai.analytics.calls')}</th><th class="text-right">Token</th><th class="text-right">{t('ai.analytics.cost')}</th></tr></thead>
        <tbody>
          {#each s.byUser as u (u.userId ?? '')}
            <tr><td>{u.name ?? u.email ?? u.userId ?? '—'}{#if u.name && u.email} <span class="text-xs text-muted-foreground">{u.email}</span>{/if}</td><td class="text-right">{num(u.calls)}</td><td class="text-right">{num(u.tokensIn + u.tokensOut)}</td><td class="text-right">{money(u.costMicro)}</td></tr>
          {:else}
            <tr><td colspan="4" class="py-6 text-center text-muted-foreground">{t('common.none')}</td></tr>
          {/each}
        </tbody>
      </Table>
    </Card>
  </div>
</div>
