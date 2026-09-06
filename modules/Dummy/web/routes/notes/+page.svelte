<script lang="ts">
/** A module page: it only fills the `content` region; layout and theme belong to core (§4.8). */
let { data } = $props();
</script>

<svelte:head>
  <title>Dummy · Notes</title>
</svelte:head>

<section data-testid="module-page">
  <h1>Modul {data.module}</h1>
  <p>Halaman ini datang dari <code>modules/Dummy/web/routes/notes</code> dan disajikan di <code>{data.path}</code>.</p>
  <p><small>SSR pada {data.renderedAt}</small></p>
</section>
