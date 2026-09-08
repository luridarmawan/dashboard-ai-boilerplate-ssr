<script lang="ts">
/**
 * AI usage widget (H-15): the dashboard fetched `/v1/m/ai/analytics?days=30` as this user and
 * hands the payload in as `data` — nothing is fetched here. Null = the API refused or was down.
 */
type Stats = {
  totals: { calls: number; tokensIn: number; tokensOut: number; costMicro: number };
  byDay: { day: string; tokensIn: number; tokensOut: number }[];
};
let { context, data }: { context?: { locale: string }; data?: Stats | null } = $props();
const en = $derived(context?.locale === 'en');
const num = (n: number) => n.toLocaleString(en ? 'en-US' : 'id-ID');
const money = (micro: number) =>
  micro ? (micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2) : '—';
const max = $derived(Math.max(1, ...(data?.byDay ?? []).map((d) => d.tokensIn + d.tokensOut)));
</script>

<div class="grid gap-2 text-sm" data-testid="widget-ai-usage">
  {#if data}
    <div class="flex items-baseline justify-between gap-2">
      <p class="text-3xl font-semibold">{num(data.totals.tokensIn + data.totals.tokensOut)}</p>
      <p class="text-muted-foreground">{en ? 'tokens' : 'token'} · {num(data.totals.calls)} {en ? 'calls' : 'panggilan'}</p>
    </div>
    <div class="flex h-10 items-end gap-px" role="img" aria-label={en ? 'Tokens per day' : 'Token per hari'}>
      {#each data.byDay as d (d.day)}
        <div class="flex-1 rounded-t bg-primary/70" style={`height:${Math.max(d.tokensIn + d.tokensOut > 0 ? 6 : 0, Math.round(((d.tokensIn + d.tokensOut) / max) * 100))}%`} title={`${d.day}: ${num(d.tokensIn + d.tokensOut)}`}></div>
      {/each}
    </div>
    <p class="text-muted-foreground">{en ? 'Estimated cost' : 'Biaya estimasi'}: <span class="font-medium text-foreground">{money(data.totals.costMicro)}</span> · <a href="/m/ai/analytics">{en ? 'Analytics' : 'Analitik'} →</a></p>
  {:else}
    <p class="text-muted-foreground">{en ? 'Usage data is not available right now.' : 'Data penggunaan belum tersedia.'} <a href="/m/ai/analytics">{en ? 'Analytics' : 'Analitik'} →</a></p>
  {/if}
</div>
