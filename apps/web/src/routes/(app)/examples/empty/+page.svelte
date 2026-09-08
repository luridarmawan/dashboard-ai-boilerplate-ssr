<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Button, Card } from '$lib/components/ui';
import { useT } from '$lib/i18n';

const t = useT();
</script>

<svelte:head><title>{t('examples.prefix')} · {t('examples.empty.title')}</title></svelte:head>

<div class="page">
  <h1>{t('examples.empty.heading')}</h1>
  <Card>
    <div class="flex flex-col items-center gap-3 py-12 text-center">
      <Icon name="folder" size={40} class="text-muted-foreground" />
      <p class="text-lg font-medium">{t('examples.empty.no_products')}</p>
      <p class="max-w-sm text-sm text-muted-foreground">{t('examples.empty.hint')}</p>
      <div class="flex gap-2"><Button href="/examples/form"><Icon name="plus" size={16} />{t('examples.empty.add_product')}</Button><Button variant="outline"><Icon name="upload" size={16} />{t('examples.empty.import_csv')}</Button></div>
    </div>
  </Card>
</div>
