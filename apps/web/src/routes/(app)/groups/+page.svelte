<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { type ColumnDef, DataTable } from '$lib/components/table';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
type Row = (typeof data.groups)[number];

const columns: ColumnDef<Row>[] = [
  {
    key: 'name',
    label: t('groups.group'),
    sortKey: 'name',
    value: (r) => r.name,
  },
  { key: 'code', label: t('groups.code'), value: (r) => r.code },
  { key: 'permissions', label: t('groups.permissions'), value: (r) => r.permissionCount },
  { key: 'members', label: t('groups.members'), value: (r) => r.memberCount },
];
</script>

<svelte:head><title>{t('nav.groups')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('nav.groups')}</h1>
  </div>

  <DataTable
    rows={data.groups}
    {columns}
    state={data.state}
    caption={t('groups.caption')}
    searchPlaceholder={t('groups.search_placeholder')}
    emptyTitle={t('groups.empty_title')}
    emptyHint={data.state.q ? t('groups.empty_hint_search') : t('groups.empty_hint_add')}
    rowActions={[{ label: can('group.edit') ? t('groups.manage') : t('common.view'), icon: can('group.edit') ? 'edit' : 'eye', iconOnly: true, href: (r) => `/groups/${r.id}` }]}
  >
    {#snippet toolbar()}
      {#if can('group.create')}<Button href="/groups/new" size="sm"><Icon name="plus" size={16} />{t('groups.add')}</Button>{/if}
    {/snippet}
    {#snippet cell(row, col)}
      {#if col.key === 'name'}
        <a href={`/groups/${row.id}`} class="font-medium text-foreground">{row.name}</a>
        {#if row.isSystem} <code>{t('groups.system_tag')}</code>{/if}
      {:else if col.key === 'code'}
        <code>{row.code}</code>
      {:else}
        {col.value ? (col.value(row) ?? '—') : '—'}
      {/if}
    {/snippet}
  </DataTable>

  <!--
    C-8: a group page shows permissions as a grid of checkboxes, which says WHICH permissions a
    group has but never what one MEANS. The guide is where that is explained, and it needs the
    same `group.read` this page does, so the link is always reachable from here.
  -->
  <p class="text-sm text-muted-foreground">
    {t('groups.permission_guide_lead')}
    <a href="/permissions" class="inline-flex items-center gap-1"><Icon name="help" size={14} />{t('nav.permissions')}</a>
  </p>
</div>
