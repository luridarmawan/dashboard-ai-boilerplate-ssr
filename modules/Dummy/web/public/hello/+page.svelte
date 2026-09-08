<script lang="ts">
import { useT } from '$lib/i18n';

/** A public module page: rendered inside the theme's public layout, indexable without JavaScript. */
const t = useT();
</script>

<svelte:head>
  <title>{t('dummy.hello.title')}</title>
  <meta name="description" content={t('dummy.hello.description')} />
</svelte:head>

<section class="mx-auto max-w-3xl px-4 py-16" data-testid="public-module-page">
  <h1>{t('dummy.hello.heading')}</h1>
  <p class="mt-2 text-muted-foreground">{t('dummy.hello.lead_1')}<code>public.ts</code>{t('dummy.hello.lead_2')}<code>/hello-dummy</code>{t('dummy.hello.lead_3')}<code>/m/*</code>{t('dummy.hello.lead_4')}</p>
</section>
