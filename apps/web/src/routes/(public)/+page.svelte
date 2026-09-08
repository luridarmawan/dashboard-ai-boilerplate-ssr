<script lang="ts">
import { useT } from '$lib/i18n';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
const t = useT();
</script>

<svelte:head>
  <title>{data.app.name || t('app.name')}</title>
</svelte:head>

<div class="page">
  <h1>{t('landing.title')}</h1>
  <p class="muted">{t('app.tagline')}</p>
  {#if data.api}
    <p data-testid="api-status">
      API <code>{data.api.name}@{data.api.version}</code> · dialect <code>{data.api.dialect}</code>
      · modul: {data.api.modules.map((m) => `${m.name}@${m.version}`).join(', ') || '—'}
    </p>
  {:else}
    <p data-testid="api-status">{t('landing.api_unreachable')} ({data.apiError ?? 'tanpa respons'})</p>
  {/if}
  <p><a href="/auth/login">{t('nav.login')}</a> · <a href="/auth/register">{t('nav.register')}</a></p>
  <p><small>request {data.requestId}</small></p>
</div>
