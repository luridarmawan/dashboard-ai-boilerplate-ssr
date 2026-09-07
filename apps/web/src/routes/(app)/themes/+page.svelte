<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Table } from '$lib/components/ui';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const fmt = (iso: string) => new Date(iso).toLocaleString('id-ID');
const swatch = (t: (typeof data.themes)[number]) =>
  ['background', 'primary', 'accent', 'foreground'].map((k) => t.tokens.light[k] ?? '#ccc');
</script>

<svelte:head><title>Tema kustom</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>Tema kustom {#if data.scope === 'global'}<Badge variant="outline">global</Badge>{/if}</h1>
    <div class="flex flex-wrap gap-2">
      {#if data.canGlobal}
        <Button href={data.scope === 'global' ? '/themes' : '/themes?scope=global'} variant="outline" size="sm">{data.scope === 'global' ? 'Lihat tema tenant' : 'Lihat tema global'}</Button>
      {/if}
      <Button href={`/themes/new${data.scope === 'global' ? '?scope=global' : ''}`} size="sm"><Icon name="plus" size={16} />Buat tema</Button>
    </div>
  </div>
  <p class="text-sm text-muted-foreground">Rakit tema dari nilai token, set ikon, dan layout yang sudah terdaftar, lalu simpan — berlaku seketika di semua instance tanpa deploy (L-24). Setiap tema harus lolos kontras WCAG AA (L-21) sebelum tersimpan. Tema dari berkas (core dan modul) tidak diubah di sini; ia bisa dijadikan titik awal.</p>
  {#if data.saved === 'created'}<p class="notice">Tema dibuat.</p>{:else if data.saved === 'deleted'}<p class="notice">Tema dihapus.</p>{:else if data.saved === 'default'}<p class="notice">Tema baku diperbarui.</p>{/if}
  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

  <Table caption="Tema kustom">
    <thead><tr><th>Tema</th><th>Id</th><th>Turunan</th><th>Set ikon</th><th>Layout dasbor</th><th>Status</th><th>Diubah</th><th></th></tr></thead>
    <tbody>
      {#each data.themes as t (t.id)}
        <tr data-testid="custom-theme-row">
          <td>
            <div class="flex items-center gap-2">
              <span class="flex overflow-hidden rounded border" aria-hidden="true">{#each swatch(t) as c, i (i)}<span class="block h-5 w-5" style={`background:${c}`}></span>{/each}</span>
              <span class="font-medium">{t.name.id}</span>
            </div>
          </td>
          <td><code>{t.code}</code>{#if data.defaultTheme === t.code} <Badge variant="success">baku</Badge>{/if}</td>
          <td class="text-muted-foreground">{t.base}</td>
          <td class="text-muted-foreground">{t.icons}</td>
          <td class="text-muted-foreground">{t.layouts.dashboard?.default ?? '—'}</td>
          <td>{#if t.enabled}<Badge variant="success">aktif</Badge>{:else}<Badge variant="secondary">nonaktif</Badge>{/if}</td>
          <td class="whitespace-nowrap text-muted-foreground">{fmt(t.updatedAt)}</td>
          <td class="whitespace-nowrap text-right">
            <a href={`/themes/${t.id}`}>Ubah</a>
            {#if t.enabled && data.defaultTheme !== t.code}
              · <form method="POST" action="?/setDefault" class="inline"><Csrf token={data.csrf} /><input type="hidden" name="theme" value={t.code} /><input type="hidden" name="scope" value={data.scope} /><button type="submit" class="underline">Jadikan baku</button></form>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="8" class="py-8 text-center text-muted-foreground">Belum ada tema kustom. Mulai dari salah satu tema bawaan: {#each data.bases as b, i (b.id)}{#if i}, {/if}<a href={`/themes/new?base=${b.id}${data.scope === 'global' ? '&scope=global' : ''}`}>{b.name.id}</a>{/each}.</td></tr>
      {/each}
    </tbody>
  </Table>
</div>
