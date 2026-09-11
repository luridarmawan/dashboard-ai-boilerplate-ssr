<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Card } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/** L-19: the patterns a module author copies from — one page each. */
const t = useT();
const items = [
  {
    href: '/examples/list',
    icon: 'list',
    title: t('examples.list.title'),
    text: t('examples.list.text'),
  },
  {
    href: '/examples/form',
    icon: 'edit',
    title: t('examples.form.title'),
    text: t('examples.form.text'),
  },
  {
    href: '/examples/detail',
    icon: 'file',
    title: t('common.detail'),
    text: t('examples.detail.text'),
  },
  {
    href: '/examples/chart',
    icon: 'chart-bar',
    title: t('examples.chart.title'),
    text: t('examples.chart.text'),
  },
  {
    href: '/examples/empty',
    icon: 'folder',
    title: t('examples.empty.title'),
    text: t('examples.empty.text'),
  },
  {
    href: '/examples/aside',
    icon: 'columns',
    title: t('examples.aside.title'),
    text: t('examples.aside.text'),
  },
  {
    href: '/examples/errors',
    icon: 'warning',
    title: '404 · 403 · 500',
    text: t('examples.errors.text'),
  },
] as const;
</script>

<svelte:head><title>{t('nav.examples')}</title></svelte:head>

<div class="page">
  <h1>{t('nav.examples')}</h1>
  <p class="text-muted-foreground">{t('examples.lead')}</p>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each items as it (it.href)}
      <a href={it.href} class="no-underline hover:no-underline">
        <Card class="h-full transition-colors hover:bg-accent/40">
          <div class="flex items-start gap-3">
            <Icon name={it.icon} class="mt-0.5 text-primary" />
            <div><p class="font-medium text-foreground">{it.title}</p><p class="text-sm text-muted-foreground">{it.text}</p></div>
          </div>
        </Card>
      </a>
    {/each}
  </div>
</div>
