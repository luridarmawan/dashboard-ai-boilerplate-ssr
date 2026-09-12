<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Flag from '$lib/components/Flag.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
const t = useT();
const modes = [
  { value: 'light', label: t('theme.mode.light'), icon: 'sun' },
  { value: 'dark', label: t('theme.mode.dark'), icon: 'moon' },
  { value: 'system', label: t('theme.mode.system'), icon: 'monitor' },
] as const;
/** K-7: the language names are their own, never translated — a reader looking for "English"
 * in an Indonesian page finds it. */
const langName = (l: string) => (l === 'id' ? t('lang.id') : l === 'en' ? t('lang.en') : l);
</script>

<svelte:head><title>{t('theme.title')}</title></svelte:head>

<div class="mx-auto max-w-5xl px-4 py-10">
  <h1>{t('theme.title')}</h1>
  <p class="mt-1 text-muted-foreground">
    {t('theme.lead')}{#if data.source === 'user'}{t('theme.lead_profile')}{/if}.
  </p>

  <form method="POST" class="mt-6 grid gap-8">
    <Csrf token={data.csrf} />
    {#if data.back}<input type="hidden" name="back" value={data.back} />{/if}

    <fieldset class="grid gap-3 border-0 p-0">
      <legend class="mb-2 text-sm font-medium">{t('theme.theme')}</legend>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {#each data.themes as th (th.id)}
          <label class="group relative grid cursor-pointer gap-3 rounded-lg border bg-card p-3 text-card-foreground has-checked:border-primary has-checked:ring-2 has-checked:ring-ring/40">
            <input type="radio" name="theme" value={th.id} checked={th.id === data.current} class="absolute top-3 end-3 h-4 w-4 accent-primary" />
            <div class="overflow-hidden rounded-md border" aria-hidden="true">{@html th.preview}</div>
            <div>
              <p class="font-medium">{th.name}</p>
              <p class="text-sm text-muted-foreground">{th.description}</p>
              <p class="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground">
                <span class="rounded-sm bg-muted px-1.5 py-0.5">{t('theme.layout')} {th.layout}</span>
                <span class="rounded-sm bg-muted px-1.5 py-0.5">{t('theme.icons')} {th.icons}</span>
              </p>
            </div>
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="grid gap-3 border-0 p-0">
      <legend class="mb-2 text-sm font-medium">{t('theme.language')}</legend>
      <div class="flex flex-wrap gap-3">
        {#each data.locales as l (l)}
          <label class="flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm has-checked:border-primary has-checked:ring-2 has-checked:ring-ring/40">
            <input type="radio" name="lang" value={l} checked={l === data.locale} class="h-4 w-4 accent-primary" />
            <Flag locale={l} />{langName(l)}
          </label>
        {/each}
      </div>
      <p class="text-xs text-muted-foreground">{t('theme.language_hint')}</p>
    </fieldset>

    <fieldset class="grid gap-3 border-0 p-0">
      <legend class="mb-2 text-sm font-medium">{t('theme.mode')}</legend>
      <div class="flex flex-wrap gap-3">
        {#each modes as m (m.value)}
          <label class="flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm has-checked:border-primary has-checked:ring-2 has-checked:ring-ring/40">
            <input type="radio" name="mode" value={m.value} checked={m.value === data.mode} class="h-4 w-4 accent-primary" />
            <Icon name={m.icon} size={16} />{m.label}
          </label>
        {/each}
      </div>
      <p class="text-xs text-muted-foreground">{t('theme.mode_hint')}</p>
    </fieldset>

    <div class="flex items-center gap-3">
      <Button type="submit"><Icon name="save" size={16} />{t('common.apply')}</Button>
      {#if data.back}<a href={data.back} class="text-sm">{t('common.back')}</a>{/if}
    </div>
  </form>
</div>
