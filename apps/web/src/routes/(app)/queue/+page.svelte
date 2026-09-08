<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, Table } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

/**
 * Job queue admin (P2): counts per status, the rows (filter by status), retry / delete for dead
 * letters, and the tasks this build knows. Plain forms: works without JavaScript.
 */
let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const locale = useLocale() === 'en' ? 'en' : 'id';
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID') : '—';
const badge = (s: string): 'success' | 'secondary' | 'outline' | 'destructive' =>
  s === 'done'
    ? 'success'
    : s === 'running'
      ? 'secondary'
      : s === 'dead'
        ? 'destructive'
        : 'outline';
const label = (s: string) =>
  s === 'done'
    ? t('queue.status.done')
    : s === 'running'
      ? t('queue.status.running')
      : s === 'dead'
        ? t('queue.status.dead')
        : t('queue.status.pending');
const short = (v: unknown) => {
  if (v === null || v === undefined) return '—';
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};
</script>

<svelte:head><title>{t('queue.title')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1>{t('queue.title')}</h1>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">{t('queue.lead_1')}<em>dead-letter</em>{t('queue.lead_2')}<code>core.queue.work</code>{t('queue.lead_3')}</p>
    </div>
    <nav class="flex flex-wrap gap-1" aria-label={t('queue.filter_status')}>
      <a href="/queue" class={`rounded-md border px-2 py-1 text-xs no-underline ${data.status ? '' : 'bg-accent'}`}>{t('queue.all')}</a>
      {#each ['pending', 'running', 'done', 'dead'] as s (s)}
        <a href={`/queue?status=${s}`} class={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs no-underline ${data.status === s ? 'bg-accent' : ''}`} data-testid={`queue-filter-${s}`}>{label(s)} <Badge variant={badge(s)}>{data.counts[s] ?? 0}</Badge></a>
      {/each}
    </nav>
  </div>
  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
  {#if data.saved === 'retried'}<p class="notice">{t('queue.retried')}</p>{:else if data.saved === 'deleted'}<p class="notice">{t('queue.deleted')}</p>{/if}

  <Table caption={t('queue.jobs')}>
    <thead><tr><th>{t('queue.created')}</th><th>{t('queue.task')}</th><th>{t('queue.status')}</th><th class="text-end">{t('queue.priority')}</th><th class="text-end">{t('queue.attempts')}</th><th>{t('queue.payload_result')}</th><th>{t('queue.schedule_finished')}</th><th></th></tr></thead>
    <tbody>
      {#each data.jobs as j (j.id)}
        <tr data-testid="queue-row" data-status={j.status}>
          <td class="whitespace-nowrap text-muted-foreground">{fmt(j.createdAt)}</td>
          <td><code>{j.name}</code>{#if j.dedupeKey}<span class="block text-xs text-muted-foreground" title={t('queue.dedupe_key')}>{j.dedupeKey}</span>{/if}</td>
          <td><Badge variant={badge(j.status)}>{label(j.status)}</Badge>{#if j.lastError}<span class="block max-w-[18rem] truncate text-xs text-destructive" title={j.lastError}>{j.lastError}</span>{/if}</td>
          <td class="text-end">{j.priority}</td>
          <td class="text-end">{j.attempts}/{j.maxAttempts}</td>
          <td class="max-w-[18rem] truncate text-xs" title={JSON.stringify(j.payload)}><code>{short(j.payload)}</code>{#if j.status === 'done'}<span class="block truncate text-muted-foreground" title={JSON.stringify(j.result)}>→ {short(j.result)}</span>{/if}</td>
          <td class="whitespace-nowrap text-muted-foreground">{j.status === 'pending' ? fmt(j.runAt) : j.status === 'running' ? `${fmt(j.startedAt)} · ${j.lockedBy ?? ''}` : fmt(j.finishedAt)}</td>
          <td class="text-end whitespace-nowrap">
            {#if can('queue.manage')}
              {#if j.status === 'dead'}
                <form method="POST" action="?/retry" class="inline"><Csrf token={data.csrf} /><input type="hidden" name="id" value={j.id} /><input type="hidden" name="status" value={data.status} /><Button type="submit" variant="ghost" size="sm" data-testid="queue-retry"><Icon name="refresh" size={14} />{t('queue.retry')}</Button></form>
              {/if}
              {#if j.status !== 'running'}
                <form method="POST" action="?/delete" class="inline"><Csrf token={data.csrf} /><input type="hidden" name="id" value={j.id} /><input type="hidden" name="status" value={data.status} /><Button type="submit" variant="ghost" size="sm" class="text-destructive" aria-label={t('common.delete')}><Icon name="trash" size={14} /></Button></form>
              {/if}
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="8" class="py-8 text-center text-muted-foreground">{data.status ? t('queue.empty_status', { status: label(data.status) }) : t('queue.empty')}</td></tr>
      {/each}
    </tbody>
  </Table>

  <Card title={t('queue.tasks_title')} description={t('queue.tasks_hint')}>
    <ul class="grid gap-1 text-sm sm:grid-cols-2">
      {#each data.tasks as tk (tk.name)}
        <li class="flex flex-wrap items-center gap-2"><code>{tk.name}</code><Badge variant="outline">{tk.module}</Badge><span class="text-xs text-muted-foreground">{t('queue.task_meta', { max: tk.maxAttempts, sec: Math.round(tk.timeoutMs / 1000) })}{#if tk.description} · {tk.description[locale]}{/if}</span></li>
      {:else}
        <li class="text-muted-foreground">{t('queue.no_tasks')}</li>
      {/each}
    </ul>
  </Card>
</div>
