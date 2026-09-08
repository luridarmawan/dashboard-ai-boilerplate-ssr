<script lang="ts">
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const t = useT();
const locale = useLocale();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID');
</script>

<svelte:head><title>{t('nav.tenants')}</title></svelte:head>

<div class="page">
  <div class="row" style="justify-content: space-between">
    <h1>{t('nav.tenants')}</h1>
    {#if can('client.create')}<a class="btn" href="/tenants/new">{t('tenants.add')}</a>{/if}
  </div>
  <table>
    <thead><tr><th>{t('tenants.name')}</th><th>{t('tenants.code')}</th><th>{t('tenants.status')}</th><th>{t('tenants.created')}</th><th></th></tr></thead>
    <tbody>
      {#each data.clients as c (c.id)}
        <tr>
          <td>{c.name}{#if c.id === data.clientId} <code>{t('common.active')}</code>{/if}</td>
          <td><code>{c.code}</code></td>
          <td>{c.statusId === 1 ? t('common.active') : t('common.inactive')}</td>
          <td class="muted">{fmtDate(c.createdAt)}</td>
          <td><a href={`/tenants/${c.id}`}>{can('client.edit') ? t('common.edit') : t('common.view')}</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
