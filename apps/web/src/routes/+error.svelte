<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/**
 * Root error page (L-19: 404/403/500). Deeper layouts have their own so errors keep the shell.
 * The 404 is the one visitors actually meet (a mistyped link, a page that moved), so it opens
 * on the full-width scene from `static/404.png` (height follows the width) with a line that
 * smiles; the rest stay plain and to the point.
 */
const t = useT();
const status = $derived(page.status);
const notFound = $derived(status === 404);
const title = $derived(
  notFound
    ? t('error.root.not_found_title')
    : status === 403
      ? t('error.root.forbidden')
      : status === 401
        ? t('error.root.unauthorized')
        : t('error.generic'),
);
</script>

<svelte:head><title>{status} · {notFound ? t('error.root.not_found') : title}</title></svelte:head>

{#if notFound}
  <main class="flex min-h-dvh flex-col" data-testid="error-404">
    <!-- The picture IS the page: edge to edge, its own aspect ratio, nothing cropped. -->
    <img src="/404.png" alt="" width="1672" height="941" class="block h-auto w-full" fetchpriority="high" />
    <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-4 px-4 py-10 text-center">
      <p class="font-mono text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">{t('error.root.not_found')}</p>
      <h1 class="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{title}</h1>
      <p class="max-w-lg text-balance text-lg text-muted-foreground">{t('error.root.not_found_lead')}</p>
      <Button href="/" class="mt-2 rounded-full px-6"><Icon name="arrow-left" size={16} class="rtl:rotate-180" />{t('common.home')}</Button>
    </div>
  </main>
{:else}
  <div class="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
    <Icon name={status === 403 || status === 401 ? 'lock' : 'error'} size={40} class="text-muted-foreground" />
    <p class="font-mono text-5xl font-semibold text-muted-foreground">{status}</p>
    <h1>{title}</h1>
    {#if page.error?.message}<p class="max-w-md text-muted-foreground">{page.error.message}</p>{/if}
    <div class="flex gap-3">
      <Button href="/">{t('common.home')}</Button>
      {#if status === 401 || status === 403}<Button href="/auth/login" variant="outline">{t('nav.login')}</Button>{/if}
    </div>
  </div>
{/if}
