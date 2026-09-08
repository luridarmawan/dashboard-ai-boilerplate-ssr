<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

/** Custom themes as a gallery (L-24): preview, swatches, where it comes from, what it uses. */
let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const swatch = (t: (typeof data.themes)[number]) =>
  ['primary', 'accent', 'secondary', 'success', 'warning', 'destructive'].map((k) => [
    k,
    t.tokens.light[k] ?? '#ccc',
  ]);
</script>

<svelte:head><title>Tema kustom</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="flex items-center gap-2">Tema kustom {#if data.scope === 'global'}<Badge variant="outline">global</Badge>{/if}</h1>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">Rakit tema dari nilai token, set ikon, dan layout yang sudah terdaftar. Tersimpan = berlaku seketika di semua instance, tanpa deploy (L-24). Setiap tema wajib lolos kontras WCAG AA (L-21). Tema dari berkas (core dan modul) menjadi titik awal, bukan diubah di sini.</p>
    </div>
    <div class="flex flex-wrap gap-2">
      {#if data.canGlobal}
        <Button href={data.scope === 'global' ? '/themes' : '/themes?scope=global'} variant="outline" size="sm"><Icon name="building" size={16} />{data.scope === 'global' ? 'Tema tenant' : 'Tema global'}</Button>
      {/if}
      <Button href={`/themes/new${data.scope === 'global' ? '?scope=global' : ''}`} size="sm"><Icon name="plus" size={16} />Buat tema</Button>
    </div>
  </div>
  {#if data.saved === 'created'}<p class="notice">Tema dibuat dan sudah bisa dipilih.</p>{:else if data.saved === 'deleted'}<p class="notice">Tema dihapus.</p>{:else if data.saved === 'default'}<p class="notice">Tema baku diperbarui.</p>{/if}
  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

  {#if data.themes.length}
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each data.themes as t (t.id)}
        <div data-testid="custom-theme-row" class="contents">
        <Card class="overflow-hidden">
          <div class="-m-5 mb-4 grid grid-cols-2 border-b">
            <div class="overflow-hidden [&_svg]:h-auto [&_svg]:w-full">{@html data.previews[t.id]?.light ?? ''}</div>
            <div class="overflow-hidden border-s [&_svg]:h-auto [&_svg]:w-full">{@html data.previews[t.id]?.dark ?? ''}</div>
          </div>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="truncate text-base">{t.name.id}</h2>
              <p class="truncate text-xs text-muted-foreground"><code>{t.code}</code></p>
            </div>
            <div class="flex shrink-0 flex-wrap justify-end gap-1">
              {#if data.defaultTheme === t.code}<Badge variant="success">baku</Badge>{/if}
              <Badge variant={t.enabled ? 'outline' : 'secondary'}>{t.enabled ? 'aktif' : 'nonaktif'}</Badge>
            </div>
          </div>
          <div class="mt-3 flex h-6 overflow-hidden rounded-md border" aria-hidden="true">
            {#each swatch(t) as [k, c] (k)}<span class="flex-1" style={`background:${c}`} title={`--${k}: ${c}`}></span>{/each}
          </div>
          <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><dt class="text-muted-foreground">Turunan</dt><dd class="truncate font-medium">{t.base}</dd></div>
            <div><dt class="text-muted-foreground">Ikon</dt><dd class="truncate font-medium">{t.icons}</dd></div>
            <div><dt class="text-muted-foreground">Layout</dt><dd class="truncate font-medium">{t.layouts.dashboard?.default ?? '—'}</dd></div>
          </dl>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span class="text-xs text-muted-foreground">diubah {fmt(t.updatedAt)}</span>
            <div class="flex gap-1">
              {#if t.enabled && data.defaultTheme !== t.code}
                <form method="POST" action="?/setDefault"><Csrf token={data.csrf} /><input type="hidden" name="theme" value={t.code} /><input type="hidden" name="scope" value={data.scope} /><Button type="submit" size="sm" variant="ghost"><Icon name="check" size={14} />Jadikan baku</Button></form>
              {/if}
              <Button href={`/themes/${t.id}`} size="sm" variant="outline"><Icon name="edit" size={14} />Ubah</Button>
            </div>
          </div>
        </Card>
        </div>
      {/each}
    </div>
  {:else}
    <Card>
      <div class="grid gap-3 py-6 text-center">
        <Icon name="palette" size={32} class="mx-auto text-muted-foreground" />
        <p class="font-medium">Belum ada tema kustom</p>
        <p class="text-sm text-muted-foreground">Mulai dari salah satu tema bawaan — semua token disalin, lalu ubah yang Anda mau.</p>
        <div class="flex flex-wrap justify-center gap-2">
          {#each data.bases as b (b.id)}<Button href={`/themes/new?base=${b.id}${data.scope === 'global' ? '&scope=global' : ''}`} variant="outline" size="sm">{b.name.id}</Button>{/each}
        </div>
      </div>
    </Card>
  {/if}
</div>
