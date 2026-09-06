<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
const modes = [
  { value: 'light', label: 'Terang', icon: 'sun' },
  { value: 'dark', label: 'Gelap', icon: 'moon' },
  { value: 'system', label: 'Ikuti sistem', icon: 'monitor' },
] as const;
</script>

<svelte:head><title>Tema &amp; tampilan</title></svelte:head>

<div class="mx-auto max-w-5xl px-4 py-10">
  <h1>Tema &amp; tampilan</h1>
  <p class="mt-1 text-muted-foreground">
    Tema mengubah warna, ikon, <em>dan</em> susunan halaman. Pilihan tersimpan di browser ini{#if data.source === 'user'} dan di profil Anda{/if}.
  </p>

  <form method="POST" class="mt-6 grid gap-8">
    <Csrf token={data.csrf} />
    {#if data.back}<input type="hidden" name="back" value={data.back} />{/if}

    <fieldset class="grid gap-3 border-0 p-0">
      <legend class="mb-2 text-sm font-medium">Tema</legend>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {#each data.themes as t (t.id)}
          <label class="group relative grid cursor-pointer gap-3 rounded-lg border bg-card p-3 text-card-foreground has-checked:border-primary has-checked:ring-2 has-checked:ring-ring/40">
            <input type="radio" name="theme" value={t.id} checked={t.id === data.current} class="absolute top-3 right-3 h-4 w-4 accent-primary" />
            <div class="overflow-hidden rounded-md border" aria-hidden="true">{@html t.preview}</div>
            <div>
              <p class="font-medium">{t.name}</p>
              <p class="text-sm text-muted-foreground">{t.description}</p>
              <p class="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground">
                <span class="rounded-sm bg-muted px-1.5 py-0.5">layout {t.layout}</span>
                <span class="rounded-sm bg-muted px-1.5 py-0.5">ikon {t.icons}</span>
              </p>
            </div>
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="grid gap-3 border-0 p-0">
      <legend class="mb-2 text-sm font-medium">Mode</legend>
      <div class="flex flex-wrap gap-3">
        {#each modes as m (m.value)}
          <label class="flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm has-checked:border-primary has-checked:ring-2 has-checked:ring-ring/40">
            <input type="radio" name="mode" value={m.value} checked={m.value === data.mode} class="h-4 w-4 accent-primary" />
            <Icon name={m.icon} size={16} />{m.label}
          </label>
        {/each}
      </div>
      <p class="text-xs text-muted-foreground">Mode "ikuti sistem" membaca preferensi perangkat; tanpa JavaScript ia tampil terang.</p>
    </fieldset>

    <div class="flex items-center gap-3">
      <Button type="submit"><Icon name="save" size={16} />Terapkan</Button>
      {#if data.back}<a href={data.back} class="text-sm">Kembali</a>{/if}
    </div>
  </form>
</div>
