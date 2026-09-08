<script lang="ts">
import { onMount } from 'svelte';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { renderMarkdown } from '../../lib/markdown.ts';

/**
 * Chat UI (H-3, H-7, H-8). The markup is a plain form that works without JavaScript; with it,
 * `submit` is intercepted and the reply streams from ./stream into the last bubble, with a Stop
 * button wired to an AbortController and `beforeunload` cancelling in-flight requests.
 */
let { data, form } = $props();
const t = useT();

type ToolChip = { name: string; status: 'running' | 'ok' | 'error' };
type Msg = { id: string; role: string; content: string; html: string; tools?: ToolChip[] };
// Seeded from server data so the first HTML already carries the history (no-JS path, H-6/H-8).
// svelte-ignore state_referenced_locally -- the $effect below re-syncs on navigation
let messages = $state<Msg[]>(data.conversation?.messages ?? []);
let draft = $state('');
let streaming = $state(false);
let streamError = $state<string | null>(null);
let controller: AbortController | null = null;
let listEl: HTMLElement | undefined = $state();

$effect(() => {
  messages = data.conversation?.messages ?? [];
});
const groups = $derived.by(() => {
  const now = Date.now();
  const day = 86_400_000;
  const g: Record<'today' | 'yesterday' | 'week' | 'older', typeof data.conversations> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };
  for (const c of data.conversations) {
    const at = new Date(c.lastMessageAt ?? c.createdAt).getTime();
    const age = now - at;
    if (age < day) g.today.push(c);
    else if (age < 2 * day) g.yesterday.push(c);
    else if (age < 7 * day) g.week.push(c);
    else g.older.push(c);
  }
  return g;
});
/** Picker value `code::model`; the conversation's current pick, else the tenant default. */
const currentPick = $derived.by(() => {
  const c = data.conversation;
  if (!c?.providerId) return 'default';
  const p = data.providers.find((x: { id: string }) => x.id === c.providerId);
  return p ? `${p.code}::${c.model ?? p.defaultModel}` : 'default';
});
const errorText = $derived(
  data.error === 'no_api_key'
    ? t('ai.chat.no_key')
    : data.error === 'ai_disabled'
      ? t('ai.chat.disabled')
      : data.error === 'tenant_quota' ||
          data.error === 'user_quota' ||
          data.error === 'credit_exhausted'
        ? t('ai.quota.exhausted')
        : data.error
          ? t('ai.chat.error')
          : null,
);

function scrollDown() {
  queueMicrotask(() => listEl?.scrollTo({ top: listEl.scrollHeight }));
}

async function streamSend(e: SubmitEvent) {
  const formEl = e.currentTarget as HTMLFormElement;
  const content = draft.trim();
  if (!content || streaming) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  streamError = null;
  const fd = new FormData(formEl);
  fd.set('history', JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content }))));
  messages = [
    ...messages,
    { id: `u-${Date.now()}`, role: 'user', content, html: '' },
    { id: `a-${Date.now()}`, role: 'assistant', content: '', html: '' },
  ];
  draft = '';
  scrollDown();
  streaming = true;
  controller = new AbortController();
  let createdId = '';
  try {
    const res = await fetch(formEl.dataset.stream ?? '', {
      method: 'POST',
      body: fd,
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    });
    createdId = res.headers.get('x-conversation-id') ?? '';
    if (!res.ok || !res.body) {
      const body = await res.text();
      let reason = 'failed';
      try {
        reason =
          (JSON.parse(body) as { error?: { details?: { reason?: string }; code?: string } }).error
            ?.details?.reason ?? 'failed';
      } catch {
        /* keep generic */
      }
      streamError =
        reason === 'no_api_key'
          ? t('ai.chat.no_key')
          : reason === 'ai_disabled'
            ? t('ai.chat.disabled')
            : reason === 'tenant_quota' || reason === 'user_quota' || reason === 'credit_exhausted'
              ? t('ai.quota.exhausted')
              : t('ai.chat.error');
      messages = messages.slice(0, -1);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let acc = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim();
        if (!d || d === '[DONE]') continue;
        try {
          const j = JSON.parse(d) as {
            choices?: { delta?: { content?: string } }[];
            dab?: { tool?: ToolChip };
            error?: { message?: string };
          };
          if (j.error) {
            streamError = t('ai.chat.error');
            continue;
          }
          const tool = j.dab?.tool;
          if (tool) {
            // Tool activity (extension point 8): one chip per call, updated in place when it ends.
            const last = messages[messages.length - 1];
            if (last) {
              const chips = [...(last.tools ?? [])];
              const i = chips.findIndex((c) => c.name === tool.name && c.status === 'running');
              if (tool.status === 'running' || i < 0) chips.push(tool);
              else chips[i] = tool;
              messages[messages.length - 1] = { ...last, tools: chips };
            }
            continue;
          }
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) {
            acc += delta;
            const last = messages[messages.length - 1];
            if (last)
              messages[messages.length - 1] = {
                ...last,
                content: acc,
                html: await renderMarkdown(acc),
              };
            scrollDown();
          }
        } catch {
          /* partial line */
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') streamError = t('ai.chat.error');
  } finally {
    streaming = false;
    controller = null;
    // A new conversation was created server-side on first send: reload ON it so the URL, the
    // sidebar and the persisted history line up (H-6).
    if (!data.conversation) location.href = createdId ? `/m/ai/chat?c=${createdId}` : '/m/ai/chat';
  }
}
function stop() {
  controller?.abort();
}
onMount(() => {
  const onUnload = () => controller?.abort();
  window.addEventListener('beforeunload', onUnload);
  return () => window.removeEventListener('beforeunload', onUnload);
});
function copy(text: string) {
  navigator.clipboard?.writeText(text);
}
</script>

<svelte:head><title>{t('ai.chat.title')}</title></svelte:head>

<div class="grid gap-4 lg:grid-cols-[18rem_1fr]" style="min-height: 70vh">
  <!-- sidebar (H-7) -->
  <aside class="flex flex-col gap-3 rounded-lg border bg-card p-3">
    <form method="POST" action="?/new"><Csrf token={data.csrf} /><Button type="submit" class="w-full" size="sm"><Icon name="plus" size={16} />{t('ai.chat.new')}</Button></form>
    <form method="GET" class="flex gap-1">
      <input name="q" value={data.q} placeholder={t('ai.chat.search')} class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" />
      <Button type="submit" variant="outline" size="sm"><Icon name="search" size={14} /></Button>
    </form>
    <nav class="min-h-0 flex-1 overflow-y-auto text-sm" aria-label={t('ai.chat.title')}>
      {#each [['today', t('ai.chat.today')], ['yesterday', t('ai.chat.yesterday')], ['week', t('ai.chat.week')], ['older', t('ai.chat.older')]] as [key, label] (key)}
        {@const items = groups[key as keyof typeof groups]}
        {#if items.length}
          <p class="mt-2 mb-1 px-2 text-xs font-medium text-muted-foreground">{label}</p>
          <ul class="grid gap-0.5">
            {#each items as c (c.id)}
              <li><a href={`/m/ai/chat?c=${c.id}`} class={`block truncate rounded-md px-2 py-1.5 no-underline hover:bg-accent ${data.conversation?.id === c.id ? 'bg-accent font-medium' : ''}`}>{c.title}</a></li>
            {/each}
          </ul>
        {/if}
      {/each}
      {#if !data.conversations.length}<p class="px-2 text-muted-foreground">{t('ai.chat.empty')}</p>{/if}
    </nav>
  </aside>

  <!-- conversation -->
  <section class="flex min-h-0 flex-col rounded-lg border bg-card">
    <header class="flex items-center justify-between gap-2 border-b px-4 py-2">
      <h1 class="truncate text-base font-semibold">{data.conversation?.title ?? t('ai.chat.title')}</h1>
      {#if data.conversation}
        <div class="flex flex-wrap items-center gap-1">
          {#if data.providers.length}
            <form method="POST" action="?/model" class="flex items-center gap-1" data-testid="model-picker">
              <Csrf token={data.csrf} /><input type="hidden" name="c" value={data.conversation.id} />
              <label class="sr-only" for="pm">{t('ai.chat.model')}</label>
              <select id="pm" name="pm" value={currentPick} class="h-8 max-w-56 rounded-md border border-input bg-background px-2 text-xs" onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}>
                <option value="default">{t('ai.chat.model_default')}</option>
                {#each data.providers as p (p.id)}
                  <optgroup label={p.name}>
                    {#each p.models as m (m.model)}<option value={`${p.code}::${m.model}`}>{m.label ?? m.model}</option>{/each}
                  </optgroup>
                {/each}
              </select>
              <noscript><Button type="submit" variant="ghost" size="sm">{t('ai.chat.model_change')}</Button></noscript>
            </form>
          {/if}
          <form method="POST" action="?/archive"><Csrf token={data.csrf} /><input type="hidden" name="c" value={data.conversation.id} /><input type="hidden" name="archived" value="1" /><Button type="submit" variant="ghost" size="sm"><Icon name="folder" size={14} />{t('ai.chat.archive')}</Button></form>
          <form method="POST" action="?/delete"><Csrf token={data.csrf} /><input type="hidden" name="c" value={data.conversation.id} /><Button type="submit" variant="ghost" size="sm" class="text-destructive"><Icon name="trash" size={14} />{t('ai.chat.delete')}</Button></form>
        </div>
      {/if}
    </header>
    {#if !data.aiEnabled}<p class="error m-4">{t('ai.chat.disabled')}</p>{/if}
    {#if data.quota && (data.quota.tenant.limit || data.quota.user.limit || data.quota.credit.balanceMicro !== null)}
      <p class={`mx-4 mt-2 text-xs ${data.quota.ok ? 'text-muted-foreground' : 'text-destructive'}`} data-testid="quota-line">
        {#if data.quota.user.limit}{t('ai.quota.user')}: {data.quota.user.used.toLocaleString('id-ID')} / {data.quota.user.limit.toLocaleString('id-ID')} token · {/if}
        {#if data.quota.tenant.limit}{t('ai.quota.tenant')}: {data.quota.tenant.used.toLocaleString('id-ID')} / {data.quota.tenant.limit.toLocaleString('id-ID')} token · {/if}
        {#if data.quota.credit.balanceMicro !== null}{t('ai.quota.balance')}: {(data.quota.credit.balanceMicro / 1_000_000).toFixed(4)}{/if}
        {#if !data.quota.ok} — {t('ai.quota.exhausted')}{/if}
      </p>
    {/if}
    {#if errorText || streamError || form?.error}<p class="error m-4" role="alert">{streamError ?? errorText ?? form?.error}</p>{/if}
    <div bind:this={listEl} class="flex-1 space-y-4 overflow-y-auto p-4" data-testid="messages">
      {#each messages as m (m.id)}
        <article class={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`} data-role={m.role}>
          <div class={`max-w-[80%] rounded-lg px-4 py-2 ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            {#if m.role === 'assistant'}
              {#if m.tools?.length}
                <ul class="mb-1 flex flex-wrap gap-1" aria-label={t('ai.chat.tools_used')}>
                  {#each m.tools as tl, i (i)}
                    <li class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground" data-tool={tl.name} data-status={tl.status}>
                      <Icon name="puzzle" size={12} /><code>{tl.name}</code>
                      {#if tl.status === 'running'}<span>{t('ai.chat.tool_running')}</span>{:else if tl.status === 'error'}<span class="text-destructive">{t('ai.chat.tool_error')}</span>{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if m.content}<div class="prose-chat">{@html m.html}</div>{:else}<span class="text-muted-foreground">{t('ai.chat.thinking')}</span>{/if}
              {#if m.content}<button type="button" class="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onclick={() => copy(m.content)}><Icon name="copy" size={12} />{t('ai.chat.copy')}</button>{/if}
            {:else}<p class="whitespace-pre-wrap">{m.content}</p>{/if}
          </div>
        </article>
      {:else}
        <p class="py-12 text-center text-muted-foreground">{t('ai.chat.empty')}</p>
      {/each}
    </div>
    <form method="POST" action="?/send" data-stream="/m/ai/chat/stream" onsubmit={streamSend} class="flex gap-2 border-t p-3">
      <Csrf token={data.csrf} />
      <input type="hidden" name="c" value={data.conversation?.id ?? ''} />
      <textarea name="content" bind:value={draft} required rows="2" placeholder={t('ai.chat.placeholder')} class="min-h-10 flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm" onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit(); } }}></textarea>
      {#if streaming}
        <Button type="button" variant="outline" onclick={stop}><Icon name="stop" size={16} />{t('ai.chat.stop')}</Button>
      {:else}
        <Button type="submit" disabled={!data.aiEnabled}><Icon name="send" size={16} />{t('ai.chat.send')}</Button>
      {/if}
    </form>
  </section>
</div>

<style>
  :global(.prose-chat p) { margin: 0.25rem 0; }
  :global(.prose-chat pre.code-block) { position: relative; margin: 0.5rem 0; overflow-x: auto; border-radius: 0.5rem; background: var(--background); border: 1px solid var(--border); padding: 0.75rem; font-size: 0.85em; }
  :global(.prose-chat pre[data-lang]::before) { content: attr(data-lang); position: absolute; right: 0.5rem; top: 0.25rem; font-size: 0.7em; color: var(--muted-foreground); }
  :global(.prose-chat code:not(pre code)) { background: var(--background); padding: 0 0.3rem; border-radius: 0.25rem; }
  :global(.prose-chat ul), :global(.prose-chat ol) { padding-left: 1.25rem; }
  :global(.prose-chat a) { text-decoration: underline; }
</style>
