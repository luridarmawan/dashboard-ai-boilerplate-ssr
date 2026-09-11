<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Card } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';

/**
 * The side content of `/examples/aside`. It takes NO props: the shell resolved it by name, so
 * it reads the page's own `load` data through `page.data` — which keeps one page owning both
 * its main content and its side column, and keeps the shell ignorant of either.
 */
const t = useT();
const locale = useLocale() === 'en' ? 'en' : 'id';
interface Item {
  done: boolean;
  key: string;
}
const data = $derived(page.data as { checklist?: Item[]; updatedAt?: string });
const checklist = $derived(data.checklist ?? []);
const label = (key: string) =>
  key === 'declare'
    ? t('examples.aside.step_declare')
    : key === 'register'
      ? t('examples.aside.step_register')
      : key === 'render'
        ? t('examples.aside.step_render')
        : t('examples.aside.step_optional');
</script>

<div class="grid gap-4 lg:sticky lg:top-20">
  <Card title={t('examples.aside.panel_title')} description={t('examples.aside.panel_hint')}>
    <ul class="grid gap-2 text-sm">
      {#each checklist as item (item.key)}
        <li class="flex items-start gap-2">
          <Icon name={item.done ? 'success' : 'info'} size={16} class={item.done ? 'mt-0.5 text-success' : 'mt-0.5 text-muted-foreground'} />
          <span class={item.done ? '' : 'text-muted-foreground'}>{label(item.key)}</span>
        </li>
      {/each}
    </ul>
  </Card>
  <Card title={t('examples.aside.data_title')} description={t('examples.aside.data_hint')}>
    <p class="text-sm text-muted-foreground">
      {t('examples.aside.rendered_at')}
      <span class="block font-medium text-foreground">
        {data.updatedAt ? new Date(data.updatedAt).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID') : '—'}
      </span>
    </p>
    <p class="mt-3"><Badge variant="outline">page.data</Badge></p>
  </Card>
</div>
