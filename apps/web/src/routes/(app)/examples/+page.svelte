<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Card } from '$lib/components/ui';

/** L-19: the patterns a module author copies from — one page each. */
const items = [
  {
    href: '/examples/list',
    icon: 'list',
    title: 'Daftar CRUD',
    text: 'DataTable: cari, urut, kolom, aksi baris & massal — tanpa JavaScript.',
  },
  {
    href: '/examples/form',
    icon: 'edit',
    title: 'Form',
    text: 'FormBuilder dengan semua tipe field dan validasi skema bersama.',
  },
  {
    href: '/examples/detail',
    icon: 'file',
    title: 'Detail',
    text: 'Halaman detail: header, badge, tab, kartu ringkasan.',
  },
  {
    href: '/examples/chart',
    icon: 'chart-bar',
    title: 'Bagan',
    text: 'Bagan batang dari token warna tema, tanpa pustaka.',
  },
  {
    href: '/examples/empty',
    icon: 'folder',
    title: 'Kosong',
    text: 'State kosong dengan ajakan bertindak.',
  },
  {
    href: '/examples/errors',
    icon: 'warning',
    title: '404 · 403 · 500',
    text: 'Halaman galat di dalam shell.',
  },
] as const;
</script>

<svelte:head><title>Contoh pola</title></svelte:head>

<div class="page">
  <h1>Contoh pola</h1>
  <p class="text-muted-foreground">Halaman-halaman referensi (PRD L-19). Salin polanya ke modul Anda.</p>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each items as it (it.href)}
      <a href={it.href} class="no-underline hover:no-underline">
        <Card class="h-full transition-colors hover:bg-accent/40">
          <div class="flex items-start gap-3">
            <Icon name={it.icon} class="mt-0.5 text-primary" />
            <div><p class="font-medium text-foreground">{it.title}</p><p class="text-sm text-muted-foreground">{it.text}</p></div>
          </div>
        </Card>
      </a>
    {/each}
  </div>
</div>
