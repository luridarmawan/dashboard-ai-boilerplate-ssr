<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import Illustration404 from '$lib/components/Illustration404.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/** Error inside the dashboard shell: the API's 403/404/500 surface here, with the menu intact. */
const t = useT();
const status = $derived(page.status);
const notFound = $derived(status === 404);
const title = $derived(
  notFound
    ? t('error.root.not_found_title')
    : status === 403
      ? t('error.app.forbidden')
      : status === 401
        ? t('error.app.session_expired')
        : t('error.generic'),
);
</script>

<svelte:head><title>{status} · {notFound ? t('error.app.not_found') : title}</title></svelte:head>

<div class="page items-center py-12 text-center" data-testid={notFound ? 'error-404' : undefined}>
  {#if notFound}
    <div class="mx-auto w-full max-w-md"><Illustration404 /></div>
    <p class="font-mono text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">{t('error.app.not_found')}</p>
    <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
    <p class="mx-auto max-w-lg text-balance text-muted-foreground">{t('error.root.not_found_lead')}</p>
  {:else}
    <Icon name={status === 403 ? 'lock' : 'error'} size={36} class="mx-auto text-muted-foreground" />
    <p class="font-mono text-4xl font-semibold text-muted-foreground">{status}</p>
    <h1>{title}</h1>
    {#if page.error?.message && status >= 500}<p class="text-muted-foreground">{page.error.message}</p>{/if}
  {/if}
  <div class="flex justify-center gap-3">
    <Button href="/dashboard" variant="outline">{t('error.app.to_dashboard')}</Button>
    {#if status === 401}<Button href="/auth/login">{t('error.app.login_again')}</Button>{/if}
  </div>
</div>
