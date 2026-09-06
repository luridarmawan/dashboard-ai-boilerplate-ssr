<script lang="ts">
import { Button, Icon, Table } from '@core/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';

let { data } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
/** Eden revives ISO dates into Date objects — show them as YYYY-MM-DD. */
const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? '—'));
</script>

<svelte:head><title>{t('hello.notes.title')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('hello.notes.title')}</h1>
    <div class="flex gap-2">
      <form method="GET" class="flex gap-1"><input name="q" value={data.q} placeholder={t('common.search')} class="h-9 rounded-md border border-input bg-background px-3 text-sm" /><Button type="submit" variant="outline" size="sm"><Icon name="search" size={16} /></Button></form>
      {#if can('hello.note.create')}<Button href="/m/hello/notes/new" size="sm"><Icon name="plus" size={16} />{t('hello.notes.new')}</Button>{/if}
    </div>
  </div>
  {#if data.saved === 'deleted'}<p class="notice">{t('common.delete')}: OK</p>{/if}
  <Table caption={t('hello.notes.title')}>
    <thead><tr><th>Title</th><th>Body</th><th>Pinned</th><th></th></tr></thead>
    <tbody>
      {#each data.rows as r (r.id)}
        <tr>
          <td class="font-medium">{cell(r.title)}</td>
          <td>{cell(r.body)}</td>
          <td>{r.pinned ? '✓' : '—'}</td>
          <td class="text-right"><a href={`/m/hello/notes/${r.id}`}>{can('hello.note.edit') ? t('common.edit') : t('common.view')}</a></td>
        </tr>
      {:else}
        <tr><td colspan="4" class="py-8 text-center text-muted-foreground">{t('hello.notes.empty')}</td></tr>
      {/each}
    </tbody>
  </Table>
  <p class="text-sm text-muted-foreground">{data.meta.total} · {data.meta.page}/{data.meta.totalPages}</p>
</div>
