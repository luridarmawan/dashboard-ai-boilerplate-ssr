<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Card } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { PageData } from './$types';

/**
 * L-19 pattern: a page whose layout has a SECOND COLUMN. Every dashboard layout exposes an
 * `aside` region and collapses to one column when nothing fills it; this page fills it, so it
 * is the one place to see the region actually used — under any theme, since the layout that
 * arranges it is the theme's choice, not the page's.
 */
let { data }: { data: PageData } = $props();
const t = useT();
</script>

<svelte:head><title>{t('examples.aside.title')}</title></svelte:head>

<div class="page">
  <h1>{t('examples.aside.title')}</h1>
  <p class="max-w-3xl text-sm text-muted-foreground">{t('examples.aside.lead')}</p>

  <Card title={t('examples.aside.how_title')}>
    <ol class="grid list-decimal gap-3 ps-5 text-sm">
      <li>
        {t('examples.aside.how_1')}
        <pre class="mt-1 overflow-x-auto rounded-md border bg-muted/40 p-2 text-xs"><code>export const _aside = 'examples.aside';</code></pre>
      </li>
      <li>
        {t('examples.aside.how_2')}
        <pre class="mt-1 overflow-x-auto rounded-md border bg-muted/40 p-2 text-xs"><code>'examples.aside': () =&gt; import('./examples/Aside.svelte'),</code></pre>
      </li>
      <li>{t('examples.aside.how_3')}</li>
    </ol>
  </Card>

  <Card title={t('examples.aside.notes_title')}>
    <ul class="grid gap-2 text-sm text-muted-foreground">
      <li class="flex items-start gap-2"><Icon name="info" size={16} class="mt-0.5 shrink-0" />{t('examples.aside.note_ssr')}</li>
      <li class="flex items-start gap-2"><Icon name="info" size={16} class="mt-0.5 shrink-0" />{t('examples.aside.note_theme')}</li>
      <li class="flex items-start gap-2"><Icon name="info" size={16} class="mt-0.5 shrink-0" />{t('examples.aside.note_narrow')}</li>
    </ul>
  </Card>

  <p class="text-sm text-muted-foreground" data-testid="examples-aside-count">
    {t('examples.aside.count', { n: data.checklist.length })}
  </p>
</div>
