<script lang="ts">
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';

const t = useT();
</script>

<svelte:head><title>{t('examples.prefix')} · {t('examples.errors.short')}</title></svelte:head>

<div class="page">
  <h1>{t('examples.errors.heading')}</h1>
  <p class="text-muted-foreground">{t('examples.errors.lead_1')} <code>load</code>{t('examples.errors.lead_2')} <code>+error.svelte</code> {t('examples.errors.lead_3')}</p>
  <div class="flex gap-2">
    <Button href="?code=404" variant="outline">404</Button>
    <Button href="?code=403" variant="outline">403</Button>
    <Button href="?code=500" variant="outline">500</Button>
  </div>
</div>
