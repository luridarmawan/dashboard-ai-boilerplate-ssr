<script lang="ts">
/** A module page: it only fills the `content` region; layout and theme belong to core (§4.8). */
import { useT } from '$lib/i18n';

let { data } = $props();
const t = useT();
</script>

<svelte:head>
  <title>Dummy · Notes</title>
</svelte:head>

<section data-testid="module-page">
  <h1>{t('dummy.notes.module', { name: data.module })}</h1>
  <p>{t('dummy.notes.from')} <code>modules/Dummy/web/routes/notes</code> {t('dummy.notes.served_at')} <code>{data.path}</code>.</p>
  <p><small>{t('dummy.notes.rendered_at', { at: data.renderedAt })}</small></p>
</section>
