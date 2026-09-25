<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/**
 * Root error page (L-19: 404/403/500). Deeper layouts have their own so errors keep the shell.
 * The 404 and the 5xx are the ones visitors actually meet (a mistyped link, a page that moved, a
 * server that fell over), so each gets its scene — `static/404.png` or `static/500.png` — filling
 * the screen with the copy in its upper part; 401/403 stay plain and to the point.
 */
const t = useT();
const status = $derived(page.status);
const notFound = $derived(status === 404);
const serverError = $derived(status >= 500);
const title = $derived(
  notFound
    ? t('error.root.not_found_title')
    : serverError
      ? t('error.root.server_error_title', { status })
      : status === 403
        ? t('error.root.forbidden')
        : status === 401
          ? t('error.root.unauthorized')
          : t('error.generic'),
);
const eyebrow = $derived(
  notFound ? t('error.root.not_found') : serverError ? t('error.root.server_error') : title,
);
</script>

<svelte:head><title>{status} · {eyebrow}</title></svelte:head>

{#if notFound || serverError}
  <!-- The picture is the whole screen (cover, centred); the copy sits in the upper part of it,
       above the robot's head, on a translucent panel so it reads on any viewport. -->
  <main
    class="flex min-h-dvh items-start justify-center bg-background bg-cover bg-center bg-no-repeat px-4 pt-[5dvh] pb-10 sm:pt-[7dvh]"
    style="background-image: url('{notFound ? '/404.png' : '/500.png'}')"
    data-testid={notFound ? 'error-404' : 'error-500'}
  >
    <div class="flex w-full max-w-lg flex-col items-center gap-3 rounded-3xl border border-border/60 bg-background/65 px-6 py-7 text-center shadow-lg backdrop-blur-[2px] sm:px-10">
      <p class="font-mono text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</p>
      <h1 class="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{title}</h1>
      <p class="text-balance text-lg text-muted-foreground">{notFound ? t('error.root.not_found_lead') : t('error.root.server_error_lead')}</p>
      {#if serverError && page.error?.message}<p class="text-sm text-muted-foreground">{page.error.message}</p>{/if}
      <div class="mt-2 flex flex-wrap justify-center gap-3">
        <Button href="/" class="rounded-full px-6"><Icon name="arrow-left" size={16} class="rtl:rotate-180" />{t('common.home')}</Button>
        {#if serverError}<Button href={page.url.pathname + page.url.search} variant="outline" class="rounded-full px-6">{t('error.root.try_again')}</Button>{/if}
      </div>
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
