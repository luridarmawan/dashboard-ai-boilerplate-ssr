<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/**
 * L-19 + F-11: the 404 handler, explained where a module author looks for patterns. The page
 * shows the live state (declared handlers, the tenant's choice) next to how it works, and a set
 * of URLs to try — each opens in a new tab so this explanation stays put.
 */
let { data } = $props();
const t = useT();
const TRY = [
  { url: '/category-food', note: 'examples.not_found.try_rule' },
  { url: '/food/nasi-goreng', note: 'examples.not_found.try_rule' },
  { url: '/single-origin', note: 'examples.not_found.try_db' },
  { url: '/gayo-arabika', note: 'examples.not_found.try_db' },
  { url: '/halaman-yang-tidak-ada', note: 'examples.not_found.try_none' },
] as const;
const steps = [1, 2, 3, 4, 5] as const;
const publicTs = `// modules/<Module>/public.ts
{ path: '/resolve', dir: 'web/public/resolve', sitemap: false, notFound: true },`;
const loaderTs = `// web/public/resolve/+page.server.ts
const trapped = trappedPath(event);           // the visitor's real URL
if (!trapped) error(404);                     // direct visit: no page of its own
const hit = matchTrap(trapped.pathname)       // 1. rule table (trap.ts)
  ?? (await lookupInDatabase(trapped));       // 2. categories / products
if (!hit) error(404);                         // not mine → built-in 404
return { hit };`;
</script>

<svelte:head><title>{t('examples.prefix')} · {t('examples.not_found.title')}</title></svelte:head>

<div class="page">
  <h1>{t('examples.not_found.heading')}</h1>
  <p class="max-w-3xl text-muted-foreground">{t('examples.not_found.lead')}</p>

  <div class="grid min-w-0 gap-4 lg:grid-cols-[1fr_1.2fr]">
    <Card>
      <h2 class="text-base font-semibold">{t('examples.not_found.state')}</h2>
      <dl class="mt-4 grid gap-3 text-sm">
        <div class="grid gap-1 sm:grid-cols-[10rem_1fr]">
          <dt class="text-muted-foreground">{t('examples.not_found.current')}</dt>
          <dd data-testid="not-found-current">
            {#if data.current}
              <Badge>{data.currentModule ?? '?'}</Badge> <code class="font-mono">{data.current}</code>
            {:else}
              <Badge variant="outline">{t('examples.not_found.builtin')}</Badge>
            {/if}
          </dd>
        </div>
        <div class="grid gap-1 sm:grid-cols-[10rem_1fr]">
          <dt class="text-muted-foreground">{t('examples.not_found.declared')}</dt>
          <dd class="flex flex-wrap gap-1.5">
            {#each data.handlers as h (h.path)}
              <code class="rounded bg-muted px-1.5 py-0.5 font-mono">{h.module} — {h.path}</code>
            {:else}
              <span class="text-muted-foreground">{t('examples.not_found.none_declared')}</span>
            {/each}
          </dd>
        </div>
      </dl>
      <p class="mt-4 text-sm text-muted-foreground">
        {data.current ? t('examples.not_found.state_on') : t('examples.not_found.state_off')}
      </p>
      {#if data.canConfigure}
        <Button href="/settings?scope=global" variant="outline" class="mt-4"><Icon name="settings" size={16} />{t('examples.not_found.open_settings')}</Button>
      {/if}
    </Card>

    <Card>
      <h2 class="text-base font-semibold">{t('examples.not_found.how')}</h2>
      <ol class="mt-4 grid gap-3 text-sm">
        {#each steps as n (n)}
          <li class="flex gap-3">
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs text-primary">{n}</span>
            <span>{t(`examples.not_found.step${n}`)}</span>
          </li>
        {/each}
      </ol>
    </Card>
  </div>

  <Card>
    <h2 class="text-base font-semibold">{t('examples.not_found.try')}</h2>
    <p class="mt-1 text-sm text-muted-foreground">{t('examples.not_found.try_lead')}</p>
    <ul class="mt-4 grid gap-2 text-sm" data-testid="not-found-try">
      {#each TRY as it (it.url)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href={it.url} target="_blank" rel="noopener" class="inline-flex items-center gap-1 font-mono">{it.url}<Icon name="external-link" size={14} /></a>
          <span class="text-muted-foreground">{t(it.note)}</span>
        </li>
      {/each}
    </ul>
  </Card>

  <!-- min-w-0 all the way down: `.page` is a grid, and a <pre> would otherwise widen its track
       to the longest code line instead of scrolling inside its card on a phone. -->
  <div class="grid min-w-0 gap-4 lg:grid-cols-2">
    <Card class="min-w-0">
      <h2 class="text-base font-semibold">{t('examples.not_found.declare')}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{t('examples.not_found.declare_lead')}</p>
      <pre class="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs"><code>{publicTs}</code></pre>
    </Card>
    <Card class="min-w-0">
      <h2 class="text-base font-semibold">{t('examples.not_found.resolve')}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{t('examples.not_found.resolve_lead')}</p>
      <pre class="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs"><code>{loaderTs}</code></pre>
    </Card>
  </div>

  <p class="text-sm text-muted-foreground">{t('examples.not_found.docs')}</p>
</div>
