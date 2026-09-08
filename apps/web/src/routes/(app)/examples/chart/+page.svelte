<script lang="ts">
import { Card } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/** Bars drawn with CSS from --chart-1..5 (L-23 later wraps a library behind one call-site). */
const t = useT();
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu'];
const series = [
  { name: 'Penjualan', color: 'var(--chart-1)', values: [42, 55, 61, 48, 72, 80, 76, 91] },
  { name: 'Retur', color: 'var(--chart-5)', values: [4, 6, 5, 7, 6, 8, 5, 6] },
];
const max = Math.max(...series.flatMap((s) => s.values));
const share = [
  { name: 'Minuman', value: 46, color: 'var(--chart-1)' },
  { name: 'Bumbu', value: 31, color: 'var(--chart-2)' },
  { name: 'Pemanis', value: 23, color: 'var(--chart-3)' },
];
</script>

<svelte:head><title>{t('examples.prefix')} · {t('examples.chart.title')}</title></svelte:head>

<div class="page">
  <h1>{t('examples.chart.title')}</h1>
  <div class="grid gap-4 lg:grid-cols-3">
    <Card title={t('examples.chart.sales_by_month')} description={t('examples.chart.sales_desc')} class="lg:col-span-2">
      <div class="flex h-56 items-end gap-3" role="img" aria-label={t('examples.chart.aria')}>
        {#each months as m, i (m)}
          <div class="flex flex-1 flex-col items-center gap-1">
            <div class="flex h-48 w-full items-end justify-center gap-1">
              {#each series as s (s.name)}
                <div class="w-full max-w-5 rounded-t-sm" style={`height:${((s.values[i] ?? 0) / max) * 100}%;background:${s.color}`} title={`${s.name} ${m}: ${s.values[i]}`}></div>
              {/each}
            </div>
            <span class="text-xs text-muted-foreground">{m}</span>
          </div>
        {/each}
      </div>
      <ul class="mt-3 flex gap-4 text-sm">{#each series as s (s.name)}<li class="flex items-center gap-2"><span class="h-3 w-3 rounded-sm" style={`background:${s.color}`}></span>{s.name}</li>{/each}</ul>
    </Card>
    <Card title={t('examples.chart.category_share')}>
      <ul class="grid gap-3">
        {#each share as s (s.name)}
          <li>
            <div class="flex justify-between text-sm"><span>{s.name}</span><span class="text-muted-foreground">{s.value}%</span></div>
            <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"><div class="h-full rounded-full" style={`width:${s.value}%;background:${s.color}`}></div></div>
          </li>
        {/each}
      </ul>
    </Card>
  </div>
</div>
