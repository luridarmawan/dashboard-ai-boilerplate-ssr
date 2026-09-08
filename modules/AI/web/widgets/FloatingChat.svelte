<script lang="ts">
import { onMount } from 'svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { renderMarkdown } from '../lib/markdown.ts';

/**
 * Floating chat (H-13): a shell widget on every dashboard page. Without JavaScript the button is a
 * link to the chat page; with it, a panel opens and the reply streams through the same bridge the
 * chat page uses, carrying the PAGE CONTEXT (path, breadcrumb, selected text) as an extra system
 * message — history stays clean, and the conversation can be continued on the full chat page.
 */
let {
  context: ctx,
}: {
  context?: {
    locale: string;
    csrf: string;
    path: string;
    breadcrumb: string[];
    appName: string;
  };
  data?: unknown;
} = $props();
const t = useT();
// Every widget prop is optional in the registry type; the shell always passes the context.
const context = $derived(ctx ?? { locale: 'id', csrf: '', path: '', breadcrumb: [], appName: '' });

type Msg = { id: string; role: 'user' | 'assistant'; content: string; html: string };
let mounted = $state(false);
let open = $state(false);
let messages = $state<Msg[]>([]);
let draft = $state('');
let streaming = $state(false);
let error = $state<string | null>(null);
let conversationId = $state('');
let selection = $state('');
let controller: AbortController | null = null;
let listEl: HTMLElement | undefined = $state();
let inputEl: HTMLTextAreaElement | undefined = $state();

const onChatPage = $derived(context.path.startsWith('/m/ai/chat'));
const pageLabel = $derived(context.breadcrumb.join(' › ') || context.path);
/** What the model learns about the page: where the user is, and what they had selected. */
const pageContext = $derived(
  [
    `Aplikasi: ${context.appName}`,
    `Halaman: ${pageLabel}`,
    `URL path: ${context.path}`,
    `Judul dokumen: ${typeof document === 'undefined' ? '' : document.title}`,
    selection ? `Teks yang disorot pengguna:\n${selection.slice(0, 1500)}` : '',
  ]
    .filter(Boolean)
    .join('\n'),
);

onMount(() => {
  mounted = true;
  const onUnload = () => controller?.abort();
  window.addEventListener('beforeunload', onUnload);
  return () => window.removeEventListener('beforeunload', onUnload);
});

function toggle() {
  if (!open) selection = window.getSelection()?.toString().trim() ?? '';
  open = !open;
  if (open) queueMicrotask(() => inputEl?.focus());
}
function reset() {
  controller?.abort();
  messages = [];
  conversationId = '';
  error = null;
}
function scrollDown() {
  queueMicrotask(() => listEl?.scrollTo({ top: listEl.scrollHeight }));
}

async function send(e: SubmitEvent) {
  e.preventDefault();
  const content = draft.trim();
  if (!content || streaming) return;
  error = null;
  const fd = new FormData();
  fd.set('_csrf', context.csrf);
  fd.set('c', conversationId);
  fd.set('content', content);
  fd.set('context', pageContext);
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
  try {
    const res = await fetch('/m/ai/chat/stream', {
      method: 'POST',
      body: fd,
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    });
    conversationId = res.headers.get('x-conversation-id') ?? conversationId;
    if (!res.ok || !res.body) {
      const body = await res.text();
      let reason = 'failed';
      try {
        reason =
          (JSON.parse(body) as { error?: { details?: { reason?: string } } }).error?.details
            ?.reason ?? 'failed';
      } catch {
        /* keep generic */
      }
      error =
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
            error?: { message?: string };
          };
          if (j.error) {
            error = t('ai.chat.error');
            continue;
          }
          const delta = j.choices?.[0]?.delta?.content;
          if (!delta) continue;
          acc += delta;
          const last = messages[messages.length - 1];
          if (last)
            messages[messages.length - 1] = {
              ...last,
              content: acc,
              html: await renderMarkdown(acc),
            };
          scrollDown();
        } catch {
          /* partial line */
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') error = t('ai.chat.error');
  } finally {
    streaming = false;
    controller = null;
  }
}
</script>

{#if ctx && !onChatPage}
  <div class="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2 print:hidden" data-testid="floating-chat">
    {#if open}
      <section class="flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg" style="height: min(32rem, calc(100vh - 6rem))" aria-label={t('ai.float.title')} data-testid="floating-chat-panel">
        <header class="flex items-center gap-2 border-b px-3 py-2">
          <Icon name="sparkles" size={16} />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">{t('ai.float.title')}</p>
            <p class="truncate text-xs text-muted-foreground" title={pageLabel}>{t('ai.float.context', { page: pageLabel })}</p>
          </div>
          {#if messages.length}
            <Button type="button" variant="ghost" size="sm" onclick={reset} aria-label={t('ai.float.new')} title={t('ai.float.new')}><Icon name="refresh" size={14} /></Button>
          {/if}
          <Button type="button" variant="ghost" size="sm" onclick={toggle} aria-label={t('ai.float.close')}><Icon name="x" size={16} /></Button>
        </header>
        <div bind:this={listEl} class="flex-1 space-y-3 overflow-y-auto p-3 text-sm" data-testid="floating-chat-messages">
          {#each messages as m (m.id)}
            <article class={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`} data-role={m.role}>
              <div class={`max-w-[85%] rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                {#if m.role === 'assistant'}
                  {#if m.content}<div class="prose-chat">{@html m.html}</div>{:else}<span class="text-muted-foreground">{t('ai.chat.thinking')}</span>{/if}
                {:else}<p class="whitespace-pre-wrap">{m.content}</p>{/if}
              </div>
            </article>
          {:else}
            <p class="py-8 text-center text-muted-foreground">{t('ai.float.empty')}</p>
          {/each}
          {#if error}<p class="error" role="alert">{error}</p>{/if}
        </div>
        <form onsubmit={send} class="flex gap-2 border-t p-2">
          <textarea bind:this={inputEl} bind:value={draft} name="content" rows="2" required placeholder={t('ai.float.placeholder')} class="min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm" onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit(); } }}></textarea>
          {#if streaming}
            <Button type="button" variant="outline" size="sm" onclick={() => controller?.abort()} aria-label={t('ai.chat.stop')}><Icon name="stop" size={16} /></Button>
          {:else}
            <Button type="submit" size="sm" aria-label={t('ai.chat.send')}><Icon name="send" size={16} /></Button>
          {/if}
        </form>
        <a href={conversationId ? `/m/ai/chat?c=${conversationId}` : '/m/ai/chat'} class="border-t px-3 py-1.5 text-center text-xs text-muted-foreground hover:text-foreground">{t('ai.float.open_full')} →</a>
      </section>
    {/if}
    {#if mounted}
      <button type="button" onclick={toggle} class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90" aria-label={t('ai.float.open')} aria-expanded={open} title={t('ai.float.open')} data-testid="floating-chat-button">
        <Icon name={open ? 'x' : 'sparkles'} size={22} />
      </button>
    {:else}
      <!-- No JavaScript yet (or never): the button is a plain link to the chat page. -->
      <a href="/m/ai/chat" class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90" aria-label={t('ai.float.open')} title={t('ai.float.open')} data-testid="floating-chat-button">
        <Icon name="sparkles" size={22} />
      </a>
    {/if}
  </div>
{/if}
