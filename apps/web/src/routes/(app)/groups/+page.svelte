<script lang="ts">
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
</script>

<svelte:head><title>{t('nav.groups')}</title></svelte:head>

<div class="page">
  <div class="row" style="justify-content: space-between">
    <h1>{t('nav.groups')}</h1>
    {#if can('group.create')}<a class="btn" href="/groups/new">{t('groups.add')}</a>{/if}
  </div>
  <table>
    <thead><tr><th>{t('groups.group')}</th><th>{t('groups.code')}</th><th>{t('groups.permissions')}</th><th>{t('groups.members')}</th><th></th></tr></thead>
    <tbody>
      {#each data.groups as g (g.id)}
        <tr>
          <td>{g.name}{#if g.isSystem} <code>{t('groups.system_tag')}</code>{/if}</td>
          <td><code>{g.code}</code></td>
          <td>{g.permissionCount}</td>
          <td>{g.memberCount}</td>
          <td><a href={`/groups/${g.id}`}>{can('group.edit') ? t('groups.manage') : t('common.view')}</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
