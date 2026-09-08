<script lang="ts" generics="Row extends { id: string }">
import type { Snippet } from 'svelte';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button, Skeleton } from '$lib/components/ui';
import { cn } from '$lib/utils';
import {
  type BulkAction,
  type ColumnDef,
  type RowAction,
  type TableState,
  withParams,
} from './columns.ts';

/**
 * Server-driven data table (L-16): paging, sorting, search, column picker, row & bulk actions,
 * empty / loading / error states — all as links and forms. Rendering only; no fetching.
 */
interface Props {
  rows: Row[];
  columns: ColumnDef<Row>[];
  state: TableState;
  csrf?: string;
  rowActions?: RowAction<Row>[];
  bulkActions?: BulkAction[];
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyHint?: string;
  loading?: boolean;
  error?: string | null;
  caption?: string;
  class?: string;
  /** Custom cell renderer: receives (row, column). Falls back to `column.value`. */
  cell?: Snippet<[Row, ColumnDef<Row>]>;
  /** Extra toolbar content (e.g. a "create" button). */
  toolbar?: Snippet;
  labels?: Partial<typeof defaultLabels>;
}
const defaultLabels = {
  search: 'Cari',
  columns: 'Kolom',
  apply: 'Terapkan',
  actions: 'Aksi',
  selectAll: 'Pilih semua',
  select: 'Pilih',
  prev: 'Sebelumnya',
  next: 'Berikutnya',
  of: 'dari',
  page: 'Halaman',
  rows: 'baris',
  perPage: 'per halaman',
  retry: 'Muat ulang',
  withSelected: 'Dengan yang dipilih',
};
let {
  rows,
  columns,
  state,
  csrf = '',
  rowActions = [],
  bulkActions = [],
  searchPlaceholder,
  emptyTitle = 'Tidak ada data',
  emptyHint,
  loading = false,
  error = null,
  caption,
  class: className,
  cell,
  toolbar,
  labels: labelOverrides = {},
}: Props = $props();

const L = $derived({ ...defaultLabels, ...labelOverrides });
const visible = $derived(
  state.cols.length
    ? columns.filter((c) => state.cols.includes(c.key))
    : columns.filter((c) => !c.hidden),
);
const sortHref = (c: ColumnDef<Row>) => {
  if (!c.sortKey) return null;
  const nextOrder = state.sort === c.sortKey && state.order === 'asc' ? 'desc' : 'asc';
  return withParams(state, { sort: c.sortKey, order: nextOrder, page: 1 });
};
const align = (c: ColumnDef<Row>) =>
  c.align === 'right' ? 'text-end' : c.align === 'center' ? 'text-center' : 'text-start';
const hasBulk = $derived(bulkActions.length > 0 && csrf !== '');
const formId = `dt-bulk-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class={cn('grid gap-3', className)}>
  <!-- toolbar: search + column picker, both plain GET forms -->
  <div class="flex flex-wrap items-center gap-2">
    <form method="GET" class="flex items-center gap-2" role="search">
      {#if state.sort}<input type="hidden" name="sort" value={state.sort} />{/if}
      <input type="hidden" name="order" value={state.order} />
      {#if state.cols.length}<input type="hidden" name="cols" value={state.cols.join(',')} />{/if}
      <label class="sr-only" for={`${formId}-q`}>{L.search}</label>
      <input id={`${formId}-q`} name="q" value={state.q} placeholder={searchPlaceholder ?? L.search} class="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm" />
      <Button type="submit" variant="outline" size="sm"><Icon name="search" size={16} />{L.search}</Button>
    </form>
    <details class="relative">
      <summary class="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent"><Icon name="columns" size={16} />{L.columns}</summary>
      <form method="GET" class="absolute z-40 mt-1 grid w-56 gap-1 rounded-md border bg-popover p-3 text-sm shadow-md">
        {#if state.q}<input type="hidden" name="q" value={state.q} />{/if}
        <input type="hidden" name="sort" value={state.sort} />
        <input type="hidden" name="order" value={state.order} />
        {#each columns as c (c.key)}
          <label class="flex items-center gap-2"><input type="checkbox" name="cols" value={c.key} checked={visible.some((v) => v.key === c.key)} class="h-4 w-4 accent-primary" />{c.label}</label>
        {/each}
        <Button type="submit" size="sm" class="mt-1">{L.apply}</Button>
      </form>
    </details>
    {#if toolbar}<div class="ms-auto flex items-center gap-2">{@render toolbar()}</div>{/if}
  </div>

  {#if error}
    <div class="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm" role="alert">
      <span class="flex items-center gap-2"><Icon name="error" />{error}</span>
      <a href={withParams(state, {})} class="text-sm">{L.retry}</a>
    </div>
  {:else}
    {#if hasBulk}<form id={formId} method="POST"><Csrf token={csrf} /></form>{/if}
    <div class="relative w-full overflow-x-auto rounded-lg border bg-card">
      <table class="w-full text-sm">
        {#if caption}<caption class="sr-only">{caption}</caption>{/if}
        <thead>
          <tr class="border-b">
            {#if hasBulk}<th class="w-8 px-3"><span class="sr-only">{L.select}</span></th>{/if}
            {#each visible as c (c.key)}
              {@const href = sortHref(c)}
              <th scope="col" class={cn('h-10 px-3 font-medium text-muted-foreground', align(c), c.class)} aria-sort={state.sort === c.sortKey ? (state.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                {#if href}
                  <a {href} class="inline-flex items-center gap-1 text-muted-foreground no-underline hover:text-foreground hover:no-underline">
                    {c.label}
                    {#if state.sort === c.sortKey}<Icon name={state.order === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} />{:else}<Icon name="sort" size={14} class="opacity-40" />{/if}
                  </a>
                {:else}{c.label}{/if}
              </th>
            {/each}
            {#if rowActions.length}<th scope="col" class="h-10 px-3 text-end font-medium text-muted-foreground">{L.actions}</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#if loading}
            {#each { length: 5 } as _, i (i)}
              <tr class="border-b last:border-0">
                {#if hasBulk}<td class="px-3 py-3"></td>{/if}
                {#each visible as c (c.key)}<td class="px-3 py-3"><Skeleton class="h-4 w-full" /></td>{/each}
                {#if rowActions.length}<td></td>{/if}
              </tr>
            {/each}
          {:else if rows.length === 0}
            <tr>
              <td colspan={visible.length + (hasBulk ? 1 : 0) + (rowActions.length ? 1 : 0)} class="px-3 py-12 text-center">
                <Icon name="folder" class="mx-auto mb-2 text-muted-foreground" size={28} />
                <p class="font-medium">{emptyTitle}</p>
                {#if emptyHint}<p class="text-sm text-muted-foreground">{emptyHint}</p>{/if}
              </td>
            </tr>
          {:else}
            {#each rows as row (row.id)}
              <tr class="border-b last:border-0 hover:bg-muted/50">
                {#if hasBulk}<td class="px-3 py-2"><input type="checkbox" name="ids" value={row.id} form={formId} class="h-4 w-4 accent-primary" aria-label={L.select} /></td>{/if}
                {#each visible as c (c.key)}
                  <td class={cn('px-3 py-2 align-middle', align(c), c.class)}>
                    {#if cell}{@render cell(row, c)}{:else}{c.value ? (c.value(row) ?? '—') : '—'}{/if}
                  </td>
                {/each}
                {#if rowActions.length}
                  <td class="px-3 py-2 text-end whitespace-nowrap">
                    {#each rowActions as a (a.label)}
                      {#if !a.when || a.when(row)}
                        {#if a.href}
                          <a href={a.href(row)} class={cn('ms-2 inline-flex items-center gap-1 text-sm', a.destructive && 'text-destructive')}>{#if a.icon}<Icon name={a.icon} size={14} />{/if}{a.label}</a>
                        {:else if a.action && csrf}
                          <form method="POST" action={a.action(row)} class="ms-2 inline">
                            <Csrf token={csrf} />
                            <button type="submit" class={cn('inline-flex items-center gap-1 text-sm text-primary hover:underline', a.destructive && 'text-destructive')}>{#if a.icon}<Icon name={a.icon} size={14} />{/if}{a.label}</button>
                          </form>
                        {/if}
                      {/if}
                    {/each}
                  </td>
                {/if}
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      {#if hasBulk && rows.length}
        <div class="flex items-center gap-2">
          <span>{L.withSelected}:</span>
          {#each bulkActions as b (b.action)}
            <Button type="submit" form={formId} formaction={b.action} variant={b.destructive ? 'destructive' : 'outline'} size="sm">{#if b.icon}<Icon name={b.icon} size={14} />{/if}{b.label}</Button>
          {/each}
        </div>
      {:else}<span></span>{/if}
      <nav class="flex items-center gap-2" aria-label="Paginasi">
        <span>{state.total} {L.rows} · {L.page} {state.page} {L.of} {state.totalPages}</span>
        <a class={cn('rounded-md border px-2 py-1 no-underline', state.page <= 1 && 'pointer-events-none opacity-40')} href={withParams(state, { page: Math.max(1, state.page - 1) })} aria-disabled={state.page <= 1}><Icon name="chevron-left" size={14} class="rtl:rotate-180" /><span class="sr-only">{L.prev}</span></a>
        <a class={cn('rounded-md border px-2 py-1 no-underline', state.page >= state.totalPages && 'pointer-events-none opacity-40')} href={withParams(state, { page: Math.min(state.totalPages, state.page + 1) })} aria-disabled={state.page >= state.totalPages}><Icon name="chevron-right" size={14} class="rtl:rotate-180" /><span class="sr-only">{L.next}</span></a>
        <form method="GET" class="flex items-center gap-1">
          {#if state.q}<input type="hidden" name="q" value={state.q} />{/if}
          <input type="hidden" name="sort" value={state.sort} /><input type="hidden" name="order" value={state.order} />
          {#if state.cols.length}<input type="hidden" name="cols" value={state.cols.join(',')} />{/if}
          <select name="limit" class="h-8 rounded-md border border-input bg-background px-1 text-sm" aria-label={L.perPage}>
            {#each [10, 20, 50, 100] as n (n)}<option value={n} selected={n === state.limit}>{n}</option>{/each}
          </select>
          <Button type="submit" variant="outline" size="sm">{L.apply}</Button>
        </form>
      </nav>
    </div>
  {/if}
</div>
