<script lang="ts">
import { Button, Icon, Table } from '@core/ui';
import { goto } from '$app/navigation';
import { navigating } from '$app/state';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';

/**
 * Two layers over one URL (L-20 over L-22). BASE: the search is an ordinary GET form and the pager
 * is a pair of links, so the page filters and pages with JavaScript off — `load` does the work.
 * ENHANCED: the same controls answer over fetch instead. Typing searches on its own after a pause,
 * only the row set is replaced, and the URL still says exactly what is on screen, so the result
 * stays shareable, bookmarkable and reachable with the back button.
 */
let { data } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
/** Eden revives ISO dates into Date objects — show them as YYYY-MM-DD. */
const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? '—'));

const base = '/m/hello/notes';
/** A link that keeps the search and changes the page — the pager's no-JavaScript half. */
const pageHref = (n: number) => {
  const p = new URLSearchParams();
  if (data.q) p.set('q', data.q);
  if (n > 1) p.set('page', String(n));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
};

// ---- enhanced layer: the same form, without the page reload ------------------------------
const busy = $derived(navigating.to !== null);
let searchForm = $state<HTMLFormElement | null>(null);
let debounce: ReturnType<typeof setTimeout> | undefined;

/** Read the form as FormData so the DOM stays the single source of truth for the query. */
function search(replace = false) {
  if (!searchForm) return;
  const p = new URLSearchParams();
  for (const [k, v] of new FormData(searchForm)) {
    const s = String(v).trim();
    if (s) p.set(k, s);
  }
  const qs = p.toString();
  void goto(qs ? `${base}?${qs}` : base, {
    keepFocus: true,
    noScroll: true,
    replaceState: replace,
  });
}
/** Typing searches by itself; the pause is what keeps it one request per word, not per keystroke. */
function typed() {
  clearTimeout(debounce);
  debounce = setTimeout(() => search(true), 300);
}
function submitSearch(event: SubmitEvent) {
  event.preventDefault();
  clearTimeout(debounce);
  search();
}
</script>

<svelte:head><title>{t('hello.notes.title')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('hello.notes.title')}</h1>
    <div class="flex flex-wrap items-center gap-2">
      <form method="GET" action={base} role="search" bind:this={searchForm} onsubmit={submitSearch} class="flex items-center gap-1" data-testid="hello-notes-search">
        <label class="sr-only" for="hello-notes-q">{t('common.search')}</label>
        <input id="hello-notes-q" type="search" name="q" value={data.q} oninput={typed} placeholder={t('hello.notes.search_hint')} maxlength="191" class="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm" />
        <Button type="submit" variant="outline" size="sm" title={t('common.search')} aria-label={t('common.search')}><Icon name={busy ? 'loader' : 'search'} size={16} class={busy ? 'animate-spin' : ''} /></Button>
        {#if data.q}<a href={base} class="text-sm text-muted-foreground">{t('hello.notes.clear')}</a>{/if}
      </form>
      {#if can('hello.note.create')}<Button href="/m/hello/notes/new" size="sm"><Icon name="plus" size={16} />{t('hello.notes.new')}</Button>{/if}
    </div>
  </div>
  {#if data.saved === 'deleted'}<p class="notice">{t('hello.notes.deleted')}</p>{/if}
  <!-- The count is the enhanced layer's receipt: it is what a screen reader hears when a search
       that never reloaded the page comes back with a different set of rows. -->
  <p class="text-sm text-muted-foreground" aria-live="polite" data-testid="hello-notes-count">{t('hello.notes.count', { total: data.meta.total })}</p>
  <div aria-busy={busy}>
    <Table caption={t('hello.notes.title')}>
      <thead><tr><th>{t('hello.note.field.title')}</th><th>{t('hello.note.field.body')}</th><th>{t('hello.note.field.pinned')}</th><th></th></tr></thead>
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
  </div>
  {#if data.meta.totalPages > 1}
    <!-- Plain links: the pager pages without JavaScript, and client-side with it. -->
    <nav class="flex items-center gap-3 text-sm" aria-label={t('table.pagination')}>
      {#if data.meta.page > 1}<a href={pageHref(data.meta.page - 1)} rel="prev">{t('table.prev')}</a>{/if}
      <span class="text-muted-foreground">{t('table.page')} {data.meta.page} {t('table.of')} {data.meta.totalPages}</span>
      {#if data.meta.page < data.meta.totalPages}<a href={pageHref(data.meta.page + 1)} rel="next">{t('table.next')}</a>{/if}
    </nav>
  {/if}
</div>
