<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';

let { data, form } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const variant = (s: string) =>
  s === 'new'
    ? 'default'
    : s === 'spam'
      ? 'destructive'
      : s === 'replied'
        ? 'success'
        : 'secondary';
</script>

<svelte:head><title>{t('example.admin.inquiries')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('example.admin.inquiries')}</h1>
    <nav class="flex gap-1 text-sm" aria-label="Filter">
      {#each ['', 'new', 'read', 'replied', 'spam'] as s (s)}
        <a href={s ? `?state=${s}` : '?'} class={`rounded-md border px-2 py-1 no-underline ${data.state === s ? 'bg-accent text-accent-foreground' : ''}`}>{s || 'semua'}</a>
      {/each}
    </nav>
  </div>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <div class="grid gap-3">
    {#each data.inquiries as q (q.id)}
      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="font-medium">{q.name} <span class="text-muted-foreground">&lt;{q.email}&gt;</span></p>
            <p class="text-xs text-muted-foreground">{new Date(q.createdAt).toLocaleString('id-ID')}{#if q.source} · {q.source}{/if}</p>
          </div>
          <Badge variant={variant(q.state)}>{q.state}</Badge>
        </div>
        <p class="mt-3 whitespace-pre-line text-sm">{q.message}</p>
        {#if can('example.inquiry.manage')}
          <form method="POST" action="?/state" class="mt-3 flex flex-wrap gap-2">
            <Csrf token={data.csrf} />
            <input type="hidden" name="id" value={q.id} />
            {#if q.state !== 'read'}<Button type="submit" name="state" value="read" size="sm" variant="outline">{t('example.admin.mark_read')}</Button>{/if}
            {#if q.state !== 'replied'}<Button type="submit" name="state" value="replied" size="sm" variant="outline">replied</Button>{/if}
            {#if q.state !== 'spam'}<Button type="submit" name="state" value="spam" size="sm" variant="ghost">{t('example.admin.mark_spam')}</Button>{/if}
          </form>
        {/if}
      </Card>
    {:else}
      <p class="rounded-lg border bg-card p-8 text-center text-muted-foreground">{t('common.none')}</p>
    {/each}
  </div>
  <p class="text-sm text-muted-foreground">{data.meta.total} · {data.meta.page}/{data.meta.totalPages}</p>
</div>
