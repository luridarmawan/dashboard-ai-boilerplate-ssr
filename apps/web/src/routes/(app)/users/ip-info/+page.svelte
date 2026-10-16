<script lang="ts">
import { Card } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { PageData } from './$types';

/** The "?" of the user list without JavaScript: the same answer as its popover, as a page. */
let { data }: { data: PageData } = $props();
const t = useT();
</script>

<svelte:head><title>{t('users.ip.title')}</title></svelte:head>

<div class="page">
  <h1>{t('users.ip.title')}</h1>
  <Card title={data.ip || '—'}>
    {#if data.error}
      <p class="text-muted-foreground" role="alert" data-testid="ip-info-error">{t(`users.ip.${data.error}`)}</p>
    {:else if data.info?.private}
      <p class="text-muted-foreground">{t('users.ip.private')}</p>
    {:else if data.info}
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-testid="ip-info">
        <dt class="text-muted-foreground">{t('users.ip.city')}</dt><dd>{data.info.city ?? '—'}</dd>
        <dt class="text-muted-foreground">{t('users.ip.region')}</dt><dd>{data.info.region ?? '—'}</dd>
        <dt class="text-muted-foreground">{t('users.ip.country')}</dt><dd>{data.info.country ?? '—'}{data.info.countryCode ? ` (${data.info.countryCode})` : ''}</dd>
        <dt class="text-muted-foreground">{t('users.ip.isp')}</dt><dd>{[data.info.isp, data.info.asn].filter(Boolean).join(' · ') || '—'}</dd>
      </dl>
    {/if}
  </Card>
  <p class="mt-4"><a href="/users">{t('users.ip.back')}</a></p>
</div>
