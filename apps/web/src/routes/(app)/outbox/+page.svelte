<script lang="ts">
import { applyAction, enhance } from '$app/forms';
import { goto, invalidateAll } from '$app/navigation';
import { navigating } from '$app/state';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Table, toast } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

/**
 * Email outbox monitoring (J-2): newest first, with status chips, a template / day-range /
 * free-text filter and sortable columns.
 *
 * Two layers (L-20 over L-22). The BASE is links and plain forms: every control works with
 * JavaScript off, and the API does the filtering either way. The ENHANCED layer makes the same
 * controls answer over fetch — the filter bar applies as you type instead of on a submit, the
 * chips / sort / paging links are client-side navigations, and retry and "deliver now" post in
 * place, toast their outcome and re-read the rows. Nothing here invents behaviour the base
 * lacks; it only removes the full page reload between the operator and the answer.
 */
let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const locale = useLocale() === 'en' ? 'en' : 'id';
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
/**
 * `DD/MM HH:MM`, always 24-hour. An outbox is scanned by day and minute — the year is noise in
 * a column that repeats on every row — so it is built from the parts rather than left to
 * `toLocaleString`, whose separators and 12/24-hour choice follow the locale. The full
 * timestamp stays one hover away in `title`, so nothing is actually lost.
 */
const two = (n: number) => String(n).padStart(2, '0');
const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
/** The unabridged value for `title`: full date, in the reader's locale. */
const fmtFull = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID') : '';
const badge = (s: string): 'success' | 'secondary' | 'outline' | 'destructive' =>
  s === 'sent'
    ? 'success'
    : s === 'sending'
      ? 'secondary'
      : s === 'failed'
        ? 'destructive'
        : 'outline';
const label = (s: string) =>
  s === 'sent'
    ? t('outbox.status.sent')
    : s === 'sending'
      ? t('outbox.status.sending')
      : s === 'failed'
        ? t('outbox.status.failed')
        : t('outbox.status.pending');

const f = $derived(data.filters);
/** Every link keeps the whole filter state; only what the caller patches changes. */
const href = (patch: Record<string, string | number | undefined> = {}) => {
  const p = new URLSearchParams();
  const base: Record<string, string | number | undefined> = {
    q: f.q || undefined,
    status: f.status || undefined,
    template: f.template || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    sort: f.sort === 'created' ? undefined : f.sort,
    order: f.order === 'desc' ? undefined : f.order,
    limit: f.limit === 50 ? undefined : f.limit,
    page: data.meta.page > 1 ? data.meta.page : undefined,
    ...patch,
  };
  if (Number(base.page) <= 1) base.page = undefined; // page 1 is the bare URL
  for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `/outbox?${s}` : '/outbox';
};
/** The current filter as a query string, so an action can send the operator back to this view. */
const currentQuery = $derived(href().split('?')[1] ?? '');
/** Clicking the active sort column flips the direction; a new column starts descending. */
const sortHref = (key: string) =>
  href({
    sort: key,
    order: f.sort === key && f.order === 'desc' ? 'asc' : 'desc',
    page: undefined,
  });
const sortIcon = (key: string) =>
  f.sort !== key ? 'sort' : f.order === 'asc' ? 'chevron-up' : 'chevron-down';
const filtered = $derived(Boolean(f.q || f.status || f.template || f.from || f.to));
/** `?delivered=picked.sent.failed.deferred`, written by our own redirect; anything else is ignored. */
const parseDelivered = (v: string | null | undefined) => {
  const parts = v?.split('.').map(Number);
  return parts?.length === 4 && parts.every((n) => Number.isFinite(n)) ? parts : null;
};
const delivered = $derived(parseDelivered(data.delivered));

// ---- enhanced layer: the same controls, without the page reload ---------------------------

/** True while a client-side navigation is loading, so the table can say it is out of date. */
const loading = $derived(navigating.to !== null);
let busy = $state<string | null>(null);
/** The filter form element, read as FormData so the DOM stays the single source of truth. */
let filterForm = $state<HTMLFormElement | null>(null);
let debounce: ReturnType<typeof setTimeout> | undefined;

/**
 * Apply the filter bar over fetch. `replace` is for keystrokes — typing eight letters should
 * leave one history entry, not eight — while an explicit change (a select, a date) gets its own
 * so Back undoes it. Paging resets: a narrower filter rarely has the page you were on.
 */
function applyFilters(replace = false) {
  if (!filterForm) return;
  const p = new URLSearchParams();
  for (const [k, v] of new FormData(filterForm)) {
    const s = String(v).trim();
    if (s) p.set(k, s);
  }
  if (p.get('limit') === '50') p.delete('limit'); // the default stays out of the URL
  const qs = p.toString();
  void goto(qs ? `/outbox?${qs}` : '/outbox', {
    keepFocus: true,
    noScroll: true,
    replaceState: replace,
  });
}
/** Typing searches on its own; the delay is what keeps it one request per pause, not per key. */
function searchTyped() {
  clearTimeout(debounce);
  debounce = setTimeout(() => applyFilters(true), 300);
}
/** A submit still exists for the keyboard (and for no-JS); it just skips the reload. */
function submitFilters(event: SubmitEvent) {
  event.preventDefault();
  clearTimeout(debounce);
  applyFilters();
}

/**
 * Both actions redirect on the no-JS path, which is how the base layer shows its notice. With
 * JavaScript we read the outcome out of that redirect, say it in a toast, and re-read the rows
 * in place — so the URL keeps meaning "the view I am looking at", never "what just happened".
 */
const runAction = (name: string, done: (location: string) => void) => () => {
  busy = name;
  return async ({ result }: { result: { type: string; location?: string; data?: unknown } }) => {
    busy = null;
    if (result.type === 'redirect') {
      done(result.location ?? '');
      await invalidateAll();
    } else if (result.type === 'failure') {
      const message = (result.data as { error?: string } | undefined)?.error;
      toast({ title: message ?? t('common.action_failed'), variant: 'error' });
    } else {
      // biome-ignore lint/suspicious/noExplicitAny: applyAction takes Kit's own result union
      await applyAction(result as any);
    }
  };
};
const paramOf = (location: string, key: string) => {
  try {
    return new URL(location, window.location.origin).searchParams.get(key);
  } catch {
    return null;
  }
};
</script>

<svelte:head><title>{t('outbox.title')}</title></svelte:head>

<!--
  `.page` is a bare `grid`, whose single implicit track is `auto` — sized to the MAX-CONTENT of
  its widest child. A table with nine nowrap columns is far wider than the shell, so the track
  grew to the table's natural width and dragged every other row (heading, filter bar, paging)
  out with it, past the viewport. `minmax(0,1fr)` caps the track at the container instead, which
  is what finally lets the table's own `overflow-x-auto` do its job and scroll on its own.
-->
<div id="outbox-monitor-container" class="page grid-cols-[minmax(0,1fr)]">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1>{t('outbox.title')}</h1>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">{t('outbox.lead')}</p>
    </div>
    {#if can('mail.manage')}
      <form
        method="POST"
        action="?/deliver"
        use:enhance={runAction('deliver', (location) => {
          const d = parseDelivered(paramOf(location, 'delivered'));
          toast({
            title: t('outbox.deliver'),
            description: t('outbox.delivered', { picked: d?.[0] ?? 0, sent: d?.[1] ?? 0, failed: d?.[2] ?? 0, deferred: d?.[3] ?? 0 }),
            variant: d?.[2] ? 'warning' : 'success',
          });
        })}
      >
        <Csrf token={data.csrf} />
        <input type="hidden" name="query" value={currentQuery} />
        <Button type="submit" variant="outline" size="sm" disabled={busy !== null} data-testid="outbox-deliver">
          <Icon name={busy === 'deliver' ? 'refresh' : 'send'} size={14} class={busy === 'deliver' ? 'animate-spin' : ''} />
          {busy === 'deliver' ? t('common.running') : t('outbox.deliver')}
        </Button>
      </form>
    {/if}
  </div>

  <nav class="flex flex-wrap gap-1" aria-label={t('outbox.filter_status')}>
    <a href={href({ status: undefined, page: undefined })} class={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs no-underline ${f.status ? '' : 'bg-accent'}`}>{t('outbox.all')} <Badge variant="outline">{data.counts.total}</Badge></a>
    {#each ['pending', 'sending', 'sent', 'failed'] as s (s)}
      <a href={href({ status: s, page: undefined })} class={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs no-underline ${f.status === s ? 'bg-accent' : ''}`} data-testid={`outbox-filter-${s}`}>{label(s)} <Badge variant={badge(s)}>{data.counts[s as 'pending' | 'sending' | 'sent' | 'failed']}</Badge></a>
    {/each}
  </nav>

  <!--
    One GET form: search, template, day range and page size travel together. Without JavaScript
    it submits and the page reloads; with it, `applyFilters` sends the same query over fetch as
    the operator types or picks, so the submit button is a fallback rather than the way in.
  -->
  <form
    method="GET"
    bind:this={filterForm}
    onsubmit={submitFilters}
    class="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3"
    role="search"
  >
    {#if f.status}<input type="hidden" name="status" value={f.status} />{/if}
    {#if f.sort !== 'created'}<input type="hidden" name="sort" value={f.sort} />{/if}
    {#if f.order !== 'desc'}<input type="hidden" name="order" value={f.order} />{/if}
    <div class="grid gap-1">
      <label class="text-xs text-muted-foreground" for="outbox-q">{t('outbox.search_label')}</label>
      <input id="outbox-q" name="q" value={f.q} oninput={searchTyped} placeholder={t('outbox.search_placeholder')} autocomplete="off" class="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm" />
    </div>
    <div class="grid gap-1">
      <label class="text-xs text-muted-foreground" for="outbox-template">{t('outbox.template')}</label>
      <select id="outbox-template" name="template" onchange={() => applyFilters()} class="h-9 rounded-md border border-input bg-background px-2 text-sm">
        <option value="">{t('outbox.template_all')}</option>
        {#each data.counts.templates as tpl (tpl.template)}
          <option value={tpl.template} selected={f.template === tpl.template}>{tpl.template} ({tpl.count})</option>
        {/each}
      </select>
    </div>
    <div class="grid gap-1">
      <label class="text-xs text-muted-foreground" for="outbox-from">{t('outbox.date_from')}</label>
      <input id="outbox-from" type="date" name="from" value={f.from} onchange={() => applyFilters()} class="h-9 rounded-md border border-input bg-background px-2 text-sm" />
    </div>
    <div class="grid gap-1">
      <label class="text-xs text-muted-foreground" for="outbox-to">{t('outbox.date_to')}</label>
      <input id="outbox-to" type="date" name="to" value={f.to} onchange={() => applyFilters()} class="h-9 rounded-md border border-input bg-background px-2 text-sm" />
    </div>
    <div class="grid gap-1">
      <label class="text-xs text-muted-foreground" for="outbox-limit">{t('table.per_page')}</label>
      <select id="outbox-limit" name="limit" onchange={() => applyFilters()} class="h-9 rounded-md border border-input bg-background px-2 text-sm">
        {#each [20, 50, 100] as n (n)}<option value={n} selected={n === f.limit}>{n}</option>{/each}
      </select>
    </div>
    <Button type="submit" variant="outline" size="sm"><Icon name={loading ? 'refresh' : 'filter'} size={14} class={loading ? 'animate-spin' : ''} />{t('common.apply')}</Button>
    {#if filtered}<a href="/outbox" class="text-sm">{t('outbox.reset')}</a>{/if}
  </form>

  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
  {#if data.saved === 'retried'}<p class="notice">{t('outbox.retried')}</p>{/if}
  {#if delivered}<p class="notice">{t('outbox.delivered', { picked: delivered[0] ?? 0, sent: delivered[1] ?? 0, failed: delivered[2] ?? 0, deferred: delivered[3] ?? 0 })}</p>{/if}

  <!-- While a fetch is in flight the rows on screen are the PREVIOUS answer: say so, don't hide them. -->
  <div aria-busy={loading} class={`min-w-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
  <Table caption={t('outbox.title')}>
    <thead>
      <tr>
        <th><a href={sortHref('created')} class="inline-flex items-center gap-1 no-underline hover:no-underline">{t('outbox.created')} <Icon name={sortIcon('created')} size={14} /></a></th>
        <th><a href={sortHref('to')} class="inline-flex items-center gap-1 no-underline hover:no-underline">{t('outbox.recipient')} <Icon name={sortIcon('to')} size={14} /></a></th>
        <th><a href={sortHref('subject')} class="inline-flex items-center gap-1 no-underline hover:no-underline">{t('outbox.subject')} <Icon name={sortIcon('subject')} size={14} /></a></th>
        <th><a href={sortHref('template')} class="inline-flex items-center gap-1 no-underline hover:no-underline">{t('outbox.template')} <Icon name={sortIcon('template')} size={14} /></a></th>
        <th><a href={sortHref('status')} class="inline-flex items-center gap-1 no-underline hover:no-underline">{t('outbox.status')} <Icon name={sortIcon('status')} size={14} /></a></th>
        <th class="text-end"><a href={sortHref('attempts')} class="inline-flex items-center gap-1 no-underline hover:no-underline">{t('outbox.attempts')} <Icon name={sortIcon('attempts')} size={14} /></a></th>
        <th><a href={sortHref('sent')} class="inline-flex items-center gap-1 no-underline hover:no-underline">{t('outbox.sent_at')} <Icon name={sortIcon('sent')} size={14} /></a></th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each data.rows as r (r.id)}
        <tr data-testid="outbox-row" data-status={r.status}>
          <td class="whitespace-nowrap text-muted-foreground" title={fmtFull(r.createdAt)}>{fmt(r.createdAt)}</td>
          <td><span class="block">{r.to}</span>{#if r.toName}<span class="block text-xs text-muted-foreground">{r.toName}</span>{/if}</td>
          <td class="max-w-[22rem] truncate" title={r.subject}>{r.subject}</td>
          <td><code>{r.template}</code> <span class="text-xs text-muted-foreground">{r.locale}</span></td>
          <td>
            <Badge variant={badge(r.status)}>{label(r.status)}</Badge>
            {#if r.lastError}<span class="block max-w-[18rem] truncate text-xs text-destructive" title={r.lastError}>{r.lastError}</span>{/if}
            {#if r.status === 'pending' && r.nextAttemptAt}<span class="block text-xs text-muted-foreground" title={fmtFull(r.nextAttemptAt)}>{t('outbox.next_attempt')} {fmt(r.nextAttemptAt)}</span>{/if}
          </td>
          <td class="text-end">{r.attempts}</td>
          <td class="whitespace-nowrap text-muted-foreground" title={fmtFull(r.sentAt)}>{fmt(r.sentAt)}{#if r.transport}<span class="block text-xs">{r.transport}</span>{/if}</td>
          <td class="text-end whitespace-nowrap">
            {#if can('mail.manage') && r.status === 'failed'}
              <form
                method="POST"
                action="?/retry"
                class="inline"
                use:enhance={runAction(`retry:${r.id}`, () =>
                  toast({ title: t('outbox.retried'), variant: 'success' }),
                )}
              >
                <Csrf token={data.csrf} />
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="query" value={currentQuery} />
                <!-- Icon only: one row action per row, and the label rides along as tooltip and
                     accessible name so nothing is lost for a screen reader. -->
                <Button type="submit" variant="ghost" size="sm" disabled={busy !== null} title={t('outbox.retry')} aria-label={t('outbox.retry')} data-testid="outbox-retry">
                  <Icon name="refresh" size={14} class={busy === `retry:${r.id}` ? 'animate-spin' : ''} />
                </Button>
              </form>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="8" class="py-8 text-center text-muted-foreground">{filtered ? t('outbox.empty_filtered') : t('outbox.empty')}</td></tr>
      {/each}
    </tbody>
  </Table>
  </div>

  {#if data.meta.totalPages > 1}
    <!-- Plain links: paging must work on a page that has no JavaScript, like the rest. -->
    <nav class="flex items-center gap-3 text-sm" aria-label={t('table.pagination')}>
      {#if data.meta.page > 1}<a href={href({ page: data.meta.page - 1 })} rel="prev">{t('table.prev')}</a>{/if}
      <span class="text-muted-foreground">{t('table.page')} {data.meta.page} {t('table.of')} {data.meta.totalPages} · {data.meta.total} {t('table.rows')}</span>
      {#if data.meta.page < data.meta.totalPages}<a href={href({ page: data.meta.page + 1 })} rel="next">{t('table.next')}</a>{/if}
    </nav>
  {/if}
</div>
