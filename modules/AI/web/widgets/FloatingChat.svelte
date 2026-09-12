<script lang="ts">
import { onMount, tick } from 'svelte';
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
let filesEl: HTMLInputElement | undefined = $state();
// The file input is icon-only, so the picked names are echoed under the box (same as the chat page).
let fileNames = $state<string[]>([]);

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
  if (!open) {
    selection = window.getSelection()?.toString().trim() ?? '';
    // Warm the markdown renderer while the panel opens: its sanitiser is a dynamic import, and
    // paying for that load mid-stream is how a first reply gets lost. Opening is early enough to
    // keep it off every other dashboard page.
    void safeRender('');
  }
  open = !open;
  if (open) {
    // Reopening keeps the transcript: land on the newest message, not on the top of the history.
    void scrollDown();
    queueMicrotask(() => inputEl?.focus());
  }
}
function reset() {
  controller?.abort();
  messages = [];
  conversationId = '';
  error = null;
}
/**
 * Jump to the newest message. `tick()` rather than a microtask because the list element can be
 * rendered by the very update that asks for the scroll — opening the panel mounts it — and a
 * microtask runs before Svelte has flushed that render.
 */
async function scrollDown() {
  await tick();
  listEl?.scrollTo({ top: listEl.scrollHeight });
}

/**
 * Markdown is a nicety, the answer is not: if `renderMarkdown` fails — its sanitiser is a dynamic
 * import, so a cold cache or an offline moment can reject it — return no HTML and let the bubble
 * fall back to the plain text it already holds. Losing the formatting beats losing the reply.
 */
async function safeRender(src: string): Promise<string> {
  try {
    return await renderMarkdown(src);
  } catch {
    return '';
  }
}

/**
 * Same composer behaviour as the chat page: one row tall, growing with the text up to the CSS
 * `max-height`, then scrolling — `height: auto` first so it shrinks again on delete/clear.
 */
function autoGrow() {
  const el = inputEl;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
// Re-measures on every draft change and whenever the panel re-mounts the textarea.
$effect(() => {
  draft;
  autoGrow();
});

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
  // H-11: the stream endpoint uploads whatever rides along as `files` and names the ids.
  for (const f of filesEl?.files ?? []) fd.append('files', f);
  messages = [
    ...messages,
    { id: `u-${Date.now()}`, role: 'user', content, html: '' },
    { id: `a-${Date.now()}`, role: 'assistant', content: '', html: '' },
  ];
  draft = '';
  // The files are in `fd` already; clear the picker so a second send does not repeat them.
  if (filesEl) filesEl.value = '';
  fileNames = [];
  void scrollDown();
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
        // Only the parse is guarded — a partial line is normal, but a failure while APPLYING a
        // frame used to be swallowed here too, which stranded the bubble on "thinking" forever.
        type Frame = {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string };
        };
        let j: Frame;
        try {
          j = JSON.parse(d) as Frame;
        } catch {
          continue; /* partial line */
        }
        if (j.error) {
          error = t('ai.chat.error');
          continue;
        }
        const delta = j.choices?.[0]?.delta?.content;
        if (!delta) continue;
        acc += delta;
        const last = messages[messages.length - 1];
        if (last)
          messages[messages.length - 1] = { ...last, content: acc, html: await safeRender(acc) };
        await scrollDown();
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
  <div class="fixed end-4 bottom-4 z-40 flex flex-col items-end gap-2 print:hidden" data-testid="floating-chat">
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
                  {#if m.content && m.html}<div class="prose-chat">{@html m.html}</div>{:else if m.content}<p class="whitespace-pre-wrap">{m.content}</p>{:else}<span class="text-muted-foreground">{t('ai.chat.thinking')}</span>{/if}
                {:else}<p class="whitespace-pre-wrap">{m.content}</p>{/if}
              </div>
            </article>
          {:else}
            <p class="py-8 text-center text-muted-foreground">{t('ai.float.empty')}</p>
          {/each}
          {#if error}<p class="error" role="alert">{error}</p>{/if}
        </div>
        <form onsubmit={send} class="border-t p-2">
          <!-- Same pill as the chat page: attach on the left, the growing textarea, send on the right. -->
          <div class="flex items-end gap-1 rounded-3xl border border-input bg-background px-2 py-1.5 focus-within:border-ring">
            <label class="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground" title={t('ai.chat.attach_hint')}>
              <Icon name="plus" size={18} /><span class="sr-only">{t('ai.chat.attach')}</span>
              <input bind:this={filesEl} type="file" name="files" multiple accept="image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,text/csv,application/json,.md,.txt,.csv,.json" class="sr-only" data-testid="floating-chat-attach" onchange={(e) => (fileNames = Array.from((e.currentTarget as HTMLInputElement).files ?? []).map((f) => f.name))} />
            </label>
            <textarea bind:this={inputEl} bind:value={draft} name="content" rows="1" required placeholder={t('ai.float.placeholder')} class="max-h-32 min-h-9 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground" oninput={autoGrow} onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit(); } }}></textarea>
            {#if streaming}
              <Button type="button" variant="outline" size="icon" class="shrink-0 rounded-full" onclick={() => controller?.abort()} title={t('ai.chat.stop')} aria-label={t('ai.chat.stop')}><Icon name="stop" size={16} /></Button>
            {:else}
              <Button type="submit" size="icon" class="shrink-0 rounded-full" title={t('ai.chat.send')} aria-label={t('ai.chat.send')}><Icon name="send" size={16} /></Button>
            {/if}
          </div>
          {#if fileNames.length}
            <ul class="mt-2 flex flex-wrap gap-1 px-2 text-xs text-muted-foreground" aria-label={t('ai.chat.attachments')} data-testid="floating-chat-attach-names">
              {#each fileNames as n (n)}<li class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"><Icon name="file" size={12} />{n}</li>{/each}
            </ul>
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
