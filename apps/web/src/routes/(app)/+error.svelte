<script lang="ts">
import { page } from '$app/state';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/** Error inside the dashboard shell: the API's 403/404/500 surface here, with the menu intact. */
const t = useT();
const status = $derived(page.status);
const title = $derived(
  status === 404
    ? t('error.app.not_found')
    : status === 403
      ? t('error.app.forbidden')
      : status === 401
        ? t('error.app.session_expired')
        : t('error.generic'),
);
</script>

<svelte:head><title>{status} · {title}</title></svelte:head>

<div class="page items-center py-16 text-center">
  <Icon name={status === 404 ? 'search' : status === 403 ? 'lock' : 'error'} size={36} class="mx-auto text-muted-foreground" />
  <p class="font-mono text-4xl font-semibold text-muted-foreground">{status}</p>
  <h1>{title}</h1>
  {#if page.error?.message && status >= 500}<p class="text-muted-foreground">{page.error.message}</p>{/if}
  <div class="flex justify-center gap-3">
    <Button href="/dashboard" variant="outline">{t('error.app.to_dashboard')}</Button>
    {#if status === 401}<Button href="/auth/login">{t('error.app.login_again')}</Button>{/if}
  </div>
</div>
