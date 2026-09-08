<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

/** Custom themes as a gallery (L-24): preview, swatches, where it comes from, what it uses. */
let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const locale = useLocale() === 'en' ? 'en' : 'id';
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const swatch = (th: (typeof data.themes)[number]) =>
  ['primary', 'accent', 'secondary', 'success', 'warning', 'destructive'].map((k) => [
    k,
    th.tokens.light[k] ?? '#ccc',
  ]);
</script>

<svelte:head><title>{t('themes.title')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="flex items-center gap-2">{t('themes.title')} {#if data.scope === 'global'}<Badge variant="outline">{t('themes.global')}</Badge>{/if}</h1>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">{t('themes.lead')}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      {#if data.canGlobal}
        <Button href={data.scope === 'global' ? '/themes' : '/themes?scope=global'} variant="outline" size="sm"><Icon name="building" size={16} />{data.scope === 'global' ? t('themes.tenant_themes') : t('themes.global_themes')}</Button>
      {/if}
      <Button href={`/themes/new${data.scope === 'global' ? '?scope=global' : ''}`} size="sm"><Icon name="plus" size={16} />{t('themes.new.title')}</Button>
    </div>
  </div>
  {#if data.saved === 'created'}<p class="notice">{t('themes.notice_created')}</p>{:else if data.saved === 'deleted'}<p class="notice">{t('themes.notice_deleted')}</p>{:else if data.saved === 'default'}<p class="notice">{t('themes.notice_default')}</p>{/if}
  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

  {#if data.themes.length}
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each data.themes as th (th.id)}
        <div data-testid="custom-theme-row" class="contents">
        <Card class="overflow-hidden">
          <div class="-m-5 mb-4 grid grid-cols-2 border-b">
            <div class="overflow-hidden [&_svg]:h-auto [&_svg]:w-full">{@html data.previews[th.id]?.light ?? ''}</div>
            <div class="overflow-hidden border-s [&_svg]:h-auto [&_svg]:w-full">{@html data.previews[th.id]?.dark ?? ''}</div>
          </div>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="truncate text-base">{th.name[locale]}</h2>
              <p class="truncate text-xs text-muted-foreground"><code>{th.code}</code></p>
            </div>
            <div class="flex shrink-0 flex-wrap justify-end gap-1">
              {#if data.defaultTheme === th.code}<Badge variant="success">{t('themes.default_badge')}</Badge>{/if}
              <Badge variant={th.enabled ? 'outline' : 'secondary'}>{th.enabled ? t('common.active') : t('common.inactive')}</Badge>
            </div>
          </div>
          <div class="mt-3 flex h-6 overflow-hidden rounded-md border" aria-hidden="true">
            {#each swatch(th) as [k, c] (k)}<span class="flex-1" style={`background:${c}`} title={`--${k}: ${c}`}></span>{/each}
          </div>
          <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><dt class="text-muted-foreground">{t('themes.base')}</dt><dd class="truncate font-medium">{th.base}</dd></div>
            <div><dt class="text-muted-foreground">{t('themes.icons')}</dt><dd class="truncate font-medium">{th.icons}</dd></div>
            <div><dt class="text-muted-foreground">{t('themes.layout')}</dt><dd class="truncate font-medium">{th.layouts.dashboard?.default ?? '—'}</dd></div>
          </dl>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span class="text-xs text-muted-foreground">{t('themes.updated', { date: fmt(th.updatedAt) })}</span>
            <div class="flex gap-1">
              {#if th.enabled && data.defaultTheme !== th.code}
                <form method="POST" action="?/setDefault"><Csrf token={data.csrf} /><input type="hidden" name="theme" value={th.code} /><input type="hidden" name="scope" value={data.scope} /><Button type="submit" size="sm" variant="ghost"><Icon name="check" size={14} />{t('themes.set_default')}</Button></form>
              {/if}
              <Button href={`/themes/${th.id}`} size="sm" variant="outline"><Icon name="edit" size={14} />{t('common.edit')}</Button>
            </div>
          </div>
        </Card>
        </div>
      {/each}
    </div>
  {:else}
    <Card>
      <div class="grid gap-3 py-6 text-center">
        <Icon name="palette" size={32} class="mx-auto text-muted-foreground" />
        <p class="font-medium">{t('themes.empty_title')}</p>
        <p class="text-sm text-muted-foreground">{t('themes.empty_lead')}</p>
        <div class="flex flex-wrap justify-center gap-2">
          {#each data.bases as b (b.id)}<Button href={`/themes/new?base=${b.id}${data.scope === 'global' ? '&scope=global' : ''}`} variant="outline" size="sm">{b.name[locale]}</Button>{/each}
        </div>
      </div>
    </Card>
  {/if}
</div>
