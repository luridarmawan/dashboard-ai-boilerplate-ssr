<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Button, Card } from '$lib/components/ui';
</script>

<svelte:head><title>Contoh · Kosong</title></svelte:head>

<div class="page">
  <h1>State kosong</h1>
  <Card>
    <div class="flex flex-col items-center gap-3 py-12 text-center">
      <Icon name="folder" size={40} class="text-muted-foreground" />
      <p class="text-lg font-medium">Belum ada produk</p>
      <p class="max-w-sm text-sm text-muted-foreground">Produk yang Anda tambahkan akan muncul di sini. Mulai dengan satu produk, atau impor dari berkas CSV.</p>
      <div class="flex gap-2"><Button href="/examples/form"><Icon name="plus" size={16} />Tambah produk</Button><Button variant="outline"><Icon name="upload" size={16} />Impor CSV</Button></div>
    </div>
  </Card>
</div>
