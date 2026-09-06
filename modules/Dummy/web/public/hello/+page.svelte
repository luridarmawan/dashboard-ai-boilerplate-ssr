<script lang="ts">
/** A public module page: rendered inside the theme's public layout, indexable without JavaScript. */
</script>

<svelte:head>
  <title>Hello from Dummy</title>
  <meta name="description" content="A public page contributed by the Dummy module (extension point 13)." />
</svelte:head>

<section class="mx-auto max-w-3xl px-4 py-16" data-testid="public-module-page">
  <h1>Halo dari modul Dummy</h1>
  <p class="mt-2 text-muted-foreground">Halaman publik ini disumbang modul lewat <code>public.ts</code> dan tampil di <code>/hello-dummy</code> — di luar <code>/m/*</code>, tanpa sesi, dengan layout publik tema aktif.</p>
</section>
