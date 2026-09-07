<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const fmt = (iso: string) =>
  new Date(iso).toLocaleString(data.user.locale === 'en' ? 'en-US' : 'id-ID');
const iconFor = (type: string) =>
  type.startsWith('token')
    ? 'key'
    : type.startsWith('module')
      ? 'grid'
      : type.includes('inquiry')
        ? 'mail'
        : 'bell';
</script>

<svelte:head><title>{t('notifications.title')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('notifications.title')} {#if data.unread}<Badge variant="default">{data.unread} {t('notifications.unread')}</Badge>{/if}</h1>
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <a href="/notifications" class={data.onlyUnread ? '' : 'font-medium'}>{t('notifications.all')}</a> ·
      <a href="/notifications?unread=1" class={data.onlyUnread ? 'font-medium' : ''}>{t('notifications.only_unread')}</a>
      {#if data.unread}
        <form method="POST" action="?/readAll"><Csrf token={data.csrf} /><Button type="submit" variant="outline" size="sm"><Icon name="check" size={14} />{t('notifications.mark_all')}</Button></form>
      {/if}
    </div>
  </div>
  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
  <ul class="grid gap-2" data-testid="notifications">
    {#each data.items as n (n.id)}
      <li class={`flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3 ${n.readAt ? 'opacity-70' : 'border-primary/40'}`} data-read={n.readAt ? 'true' : 'false'}>
        <span class={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${n.readAt ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}><Icon name={iconFor(n.type)} size={16} /></span>
        <div class="min-w-0 flex-1">
          <p class="font-medium">{n.title}</p>
          {#if n.body}<p class="text-sm text-muted-foreground">{n.body}</p>{/if}
          <p class="mt-1 text-xs text-muted-foreground"><code>{n.type}</code> · {fmt(n.createdAt)}</p>
        </div>
        <div class="flex shrink-0 gap-1">
          {#if n.link}
            <form method="POST" action="?/read"><Csrf token={data.csrf} /><input type="hidden" name="id" value={n.id} /><input type="hidden" name="link" value={n.link} /><Button type="submit" size="sm" variant="outline"><Icon name="arrow-right" size={14} />{t('notifications.open')}</Button></form>
          {/if}
          {#if !n.readAt}
            <form method="POST" action="?/read"><Csrf token={data.csrf} /><input type="hidden" name="id" value={n.id} /><Button type="submit" size="sm" variant="ghost"><Icon name="check" size={14} />{t('notifications.mark_read')}</Button></form>
          {/if}
        </div>
      </li>
    {:else}
      <li class="py-12 text-center text-muted-foreground">{t('notifications.empty')}</li>
    {/each}
  </ul>
</div>
