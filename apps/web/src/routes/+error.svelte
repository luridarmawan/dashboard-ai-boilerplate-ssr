<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/** Root error page (L-19: 404/403/500). Deeper layouts have their own so errors keep the shell. */
const t = useT();
const status = $derived(page.status);
const title = $derived(
  status === 404
    ? t('error.root.not_found')
    : status === 403
      ? t('error.root.forbidden')
      : status === 401
        ? t('error.root.unauthorized')
        : t('error.generic'),
);
</script>

<svelte:head><title>{status} · {title}</title></svelte:head>

<div class="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
  <Icon name={status === 404 ? 'search' : status === 403 || status === 401 ? 'lock' : 'error'} size={40} class="text-muted-foreground" />
  <p class="font-mono text-5xl font-semibold text-muted-foreground">{status}</p>
  <h1>{title}</h1>
  {#if page.error?.message && status !== 404}<p class="max-w-md text-muted-foreground">{page.error.message}</p>{/if}
  <div class="flex gap-3">
    <Button href="/">{t('common.home')}</Button>
    {#if status === 401 || status === 403}<Button href="/auth/login" variant="outline">{t('nav.login')}</Button>{/if}
  </div>
</div>
