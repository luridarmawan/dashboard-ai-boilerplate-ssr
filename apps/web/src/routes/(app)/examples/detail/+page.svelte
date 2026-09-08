<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, Separator, Tabs } from '$lib/components/ui';
import { useT } from '$lib/i18n';

const t = useT();
const id = $derived(page.url.searchParams.get('id') ?? '—');
</script>

<svelte:head><title>{t('examples.prefix')} · {t('common.detail')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <p class="text-sm text-muted-foreground"><a href="/examples/list">{t('examples.product')}</a> / {id.slice(-6)}</p>
      <h1 class="flex items-center gap-2">Kopi Gayo <Badge variant="success">{t('common.active')}</Badge></h1>
      <p class="text-muted-foreground">SKU KG-001 · Minuman · {t('examples.detail.updated_today')}</p>
    </div>
    <div class="flex gap-2">
      <Button href={`/examples/form?id=${id}`} variant="outline"><Icon name="edit" size={16} />{t('common.edit')}</Button>
      <Button variant="destructive"><Icon name="trash" size={16} />{t('common.delete')}</Button>
    </div>
  </div>
  <div class="grid gap-4 md:grid-cols-3">
    <Card title={t('examples.price')}><p class="text-2xl font-semibold">Rp 85.000</p><p class="text-sm text-muted-foreground">per 250 g</p></Card>
    <Card title={t('examples.stock')}><p class="text-2xl font-semibold">24</p><p class="text-sm text-muted-foreground">3 gudang</p></Card>
    <Card title={t('examples.detail.sold_30d')}><p class="text-2xl font-semibold">312</p><p class="text-sm text-success">+12%</p></Card>
  </div>
  <Card>
    <Tabs tabs={[{ value: 'info', label: t('examples.detail.tab_info') }, { value: 'history', label: t('examples.detail.tab_history') }, { value: 'files', label: t('examples.detail.tab_files') }]}>
      {#snippet content(value)}
        {#if value === 'info'}
          <dl class="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt class="text-muted-foreground">Asal</dt><dd>Aceh Tengah</dd></div>
            <div><dt class="text-muted-foreground">Proses</dt><dd>Semi-washed</dd></div>
            <div><dt class="text-muted-foreground">Ketinggian</dt><dd>1.400 mdpl</dd></div>
            <div><dt class="text-muted-foreground">Sertifikasi</dt><dd>Organik</dd></div>
          </dl>
        {:else if value === 'history'}
          <ul class="grid gap-2 text-sm">
            <li class="flex gap-3"><Icon name="clock" size={16} class="text-muted-foreground" />Harga diubah 80.000 → 85.000 <span class="text-muted-foreground">· 2 hari lalu</span></li>
            <li class="flex gap-3"><Icon name="upload" size={16} class="text-muted-foreground" />Stok masuk +50 <span class="text-muted-foreground">· 5 hari lalu</span></li>
          </ul>
        {:else}
          <p class="text-sm text-muted-foreground">{t('examples.detail.no_files')}</p>
        {/if}
      {/snippet}
    </Tabs>
    <Separator class="my-4" />
    <p class="text-xs text-muted-foreground">{t('examples.detail.tabs_note')}</p>
  </Card>
</div>
