<script lang="ts">
import { useT } from '$lib/i18n';
import type { LayoutData } from '../$types';

let { data }: { data: LayoutData } = $props();
const t = useT();
</script>

<svelte:head><title>{t('nav.dashboard')}</title></svelte:head>

<div class="page">
  <h1>{t('dashboard.hello', { name: data.user.name })}</h1>
  <div class="card">
    <p><strong>{t('dashboard.email')}:</strong> {data.user.email}{#if data.user.isSuperadmin} · <code>superadmin</code>{/if}</p>
    <p><strong>{t('dashboard.active_tenant')}:</strong> {data.tenants.find((t) => t.id === data.clientId)?.name ?? '—'}</p>
    <p><strong>{t('dashboard.permissions')}:</strong> {#if data.permissions.length}{#each data.permissions as p (p)}<code>{p}</code>{' '}{/each}{:else}<span class="muted">{t('common.none')}</span>{/if}</p>
  </div>
  <p class="muted">{t('dashboard.widgets_soon')}</p>
</div>
