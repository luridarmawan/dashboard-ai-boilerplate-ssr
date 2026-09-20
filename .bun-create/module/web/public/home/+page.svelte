<script lang="ts">
import { useT } from '$lib/i18n';

/** A public page has no session, but it still has a locale (K-2) — so it has a catalogue too. */
const t = useT();
</script>

<svelte:head><title>{t('hello.public.title')}</title><meta name="description" content={t('hello.public.lead')} /></svelte:head>
<section class="mx-auto max-w-3xl px-4 py-16" data-testid="public-hello">
  <h1>{t('hello.public.title')}</h1>
  <p class="mt-2 text-muted-foreground">{t('hello.public.lead')}</p>
</section>
