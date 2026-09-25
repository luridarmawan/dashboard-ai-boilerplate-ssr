<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/** Error inside the dashboard shell: the API's 403/404/500 surface here, with the menu intact. */
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
        ? t('error.app.forbidden')
        : status === 401
          ? t('error.app.session_expired')
          : t('error.generic'),
);
const eyebrow = $derived(
  notFound ? t('error.app.not_found') : serverError ? t('error.root.server_error') : title,
);
</script>

<svelte:head><title>{status} · {eyebrow}</title></svelte:head>

<div class="page items-center py-8 text-center" data-testid={notFound ? 'error-404' : serverError ? 'error-500' : undefined}>
  {#if notFound || serverError}
    <!-- The same scene as the root 404/5xx as the background of the content area, copy in its centre. -->
    <section
      class="flex min-h-[60dvh] w-full items-start justify-center rounded-2xl bg-cover bg-center bg-no-repeat px-4 pt-6 pb-10"
      style="background-image: url('{notFound ? '/404.png' : '/500.png'}')"
    >
      <div class="flex w-full max-w-lg flex-col items-center gap-3 rounded-3xl border border-border/60 bg-background/65 px-6 py-8 shadow-lg backdrop-blur-[2px]">
        <p class="font-mono text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</p>
        <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p class="text-balance text-muted-foreground">{notFound ? t('error.root.not_found_lead') : t('error.root.server_error_lead')}</p>
        {#if serverError && page.error?.message}<p class="text-sm text-muted-foreground">{page.error.message}</p>{/if}
      </div>
    </section>
  {:else}
    <Icon name={status === 403 ? 'lock' : 'error'} size={36} class="mx-auto text-muted-foreground" />
    <p class="font-mono text-4xl font-semibold text-muted-foreground">{status}</p>
    <h1>{title}</h1>
  {/if}
  <div class="flex justify-center gap-3">
    <Button href="/dashboard" variant="outline">{t('error.app.to_dashboard')}</Button>
    {#if serverError}<Button href={page.url.pathname + page.url.search}>{t('error.root.try_again')}</Button>{/if}
    {#if status === 401}<Button href="/auth/login">{t('error.app.login_again')}</Button>{/if}
  </div>
</div>
