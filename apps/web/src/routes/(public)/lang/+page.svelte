<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
const t = useT();
const label = (l: string) => (l === 'id' ? t('lang.id') : l === 'en' ? t('lang.en') : l);
</script>

<svelte:head><title>{t('lang.title')}</title></svelte:head>

<div class="mx-auto max-w-xl px-4 py-10">
  <h1>{t('lang.title')}</h1>
  <p class="mt-1 text-muted-foreground">{t('lang.lead')}</p>
  <form method="POST" class="mt-6 grid gap-4">
    <Csrf token={data.csrf} />
    {#if data.back}<input type="hidden" name="back" value={data.back} />{/if}
    <div class="flex flex-wrap gap-3">
      {#each data.locales as l (l)}
        <label class="flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm has-checked:border-primary has-checked:ring-2 has-checked:ring-ring/40">
          <input type="radio" name="lang" value={l} checked={l === data.current} class="h-4 w-4 accent-primary" />
          <Icon name="language" size={16} />{label(l)}
        </label>
      {/each}
    </div>
    <!-- K-9: force right-to-left without installing an RTL language — for checking themes and layouts -->
    <label class="flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <input type="checkbox" name="rtl" value="1" checked={data.rtlPreview} class="mt-0.5 h-4 w-4 accent-primary" data-testid="rtl-preview" />
      <span>{t('lang.rtl_preview')} <span class="block text-xs text-muted-foreground">{t('lang.rtl_hint', { dir: data.dir })}</span></span>
    </label>
    <div class="flex items-center gap-3">
      <Button type="submit"><Icon name="save" size={16} />{t('common.apply')}</Button>
      {#if data.back}<a href={data.back} class="text-sm">{t('common.back')}</a>{/if}
    </div>
  </form>
</div>
