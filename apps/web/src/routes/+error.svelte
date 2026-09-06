<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';

/** Root error page (L-19: 404/403/500). Deeper layouts have their own so errors keep the shell. */
const status = $derived(page.status);
const title = $derived(
  status === 404
    ? 'Halaman tidak ditemukan'
    : status === 403
      ? 'Akses ditolak'
      : status === 401
        ? 'Perlu masuk'
        : 'Terjadi kesalahan',
);
</script>

<svelte:head><title>{status} · {title}</title></svelte:head>

<div class="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
  <Icon name={status === 404 ? 'search' : status === 403 || status === 401 ? 'lock' : 'error'} size={40} class="text-muted-foreground" />
  <p class="font-mono text-5xl font-semibold text-muted-foreground">{status}</p>
  <h1>{title}</h1>
  {#if page.error?.message && status !== 404}<p class="max-w-md text-muted-foreground">{page.error.message}</p>{/if}
  <div class="flex gap-3">
    <Button href="/">Beranda</Button>
    {#if status === 401 || status === 403}<Button href="/auth/login" variant="outline">Masuk</Button>{/if}
  </div>
</div>
