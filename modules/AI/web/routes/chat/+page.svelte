<script lang="ts">
import { onMount, untrack } from 'svelte';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import Capabilities from '../../lib/Capabilities.svelte';
import { renderMarkdown } from '../../lib/markdown.ts';

/**
 * Chat UI (H-3, H-7, H-8). The markup is a plain form that works without JavaScript; with it,
 * `submit` is intercepted and the reply streams from ./stream into the last bubble, with a Stop
 * button wired to an AbortController and `beforeunload` cancelling in-flight requests.
 */
let { data, form } = $props();
const t = useT();

type ToolChip = { name: string; status: 'running' | 'ok' | 'error' };
type Att = { id: string; fileId: string; name: string; mime: string; size: number; url: string };
type Msg = {
  id: string;
  role: string;
  content: string;
  html: string;
  tools?: ToolChip[];
  parentId?: string | null;
  attachments?: Att[];
};
const STORED = /^[0-9a-f-]{36}$/; // ids of persisted messages (streamed bubbles get temp ids first)
// Seeded from server data so the first HTML already carries the history (no-JS path, H-6/H-8).
// svelte-ignore state_referenced_locally -- the $effect below re-syncs on navigation
let messages = $state<Msg[]>(data.conversation?.messages ?? []);
let draft = $state('');
let streaming = $state(false);
let streamError = $state<string | null>(null);
let controller: AbortController | null = null;
let listEl: HTMLElement | undefined = $state();
let inputEl: HTMLTextAreaElement | undefined = $state();
// The file input is icon-only now (ChatGPT-style), so the picked names are echoed under the box.
let fileNames = $state<string[]>([]);
// H-12: the parent of the next message = the last message on the shown path; updated after a stream.
// svelte-ignore state_referenced_locally -- the $effect below re-syncs on navigation
let leafId = $state<string>(data.conversation?.leafId ?? '');

$effect(() => {
  messages = data.conversation?.messages ?? [];
  leafId = data.conversation?.leafId ?? '';
  // A freshly opened conversation starts at its latest message. `untrack` matters: scrollDown reads
  // `follow`, and tracking it here would make every scroll away from the bottom re-run this effect
  // and yank the reader straight back down.
  untrack(() => scrollDown(true));
});
const versionOf = (id: string) => data.conversation?.siblings?.[id];
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
/**
 * The profile behind the current pick, so the header can show what it can actually do (§7.4).
 * A `<select>` cannot carry badges, so the matrix sits beside it and the ★ rides in the group
 * label — the ordering already puts recommended providers first (§3 no. 2).
 */
const pickedProvider = $derived.by(() => {
  const c = data.conversation;
  if (!c?.providerId) return null;
  return data.providers.find((x: { id: string }) => x.id === c.providerId) ?? null;
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

/**
 * Follow the stream, but never fight the reader: any scroll that leaves the bottom turns following
 * off, and coming back within a bubble's height turns it on again.
 */
let follow = $state(true);
function onListScroll() {
  const el = listEl;
  if (!el) return;
  follow = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
function scrollDown(force = false) {
  if (force) follow = true;
  if (!follow) return;
  // Instant, not smooth: a queued smooth animation keeps running after the reader scrolls away and
  // drags the view back to the bottom, which reads as the page fighting them.
  queueMicrotask(() => listEl?.scrollTo({ top: listEl.scrollHeight }));
}

/**
 * The panel fills what is left of the viewport instead of growing with the conversation list — a
 * long sidebar used to push the composer below the fold. The shell layout is swappable (§4.8), so
 * the space below is measured rather than guessed; the CSS height is the no-JS fallback.
 */
let rootEl: HTMLElement | undefined = $state();
function fitHeight() {
  const el = rootEl;
  if (!el) return;
  // Only what sits ABOVE us is subtracted — header, breadcrumb, page padding — so the panel ends at
  // the bottom of the viewport. Whatever the shell puts below or beside it (a footer, a second
  // column) is the shell's own scroll; measuring that too would squash the chat to fit it in.
  const above = el.getBoundingClientRect().top + window.scrollY;
  el.style.height = `${Math.max(320, window.innerHeight - above - 16)}px`;
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
 * The composer starts one row tall and grows with the text up to the CSS `max-height`, after which
 * it scrolls — `height: auto` first so shrinking on delete/clear works too.
 */
function autoGrow() {
  const el = inputEl;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
// Re-measure on every draft change, so clearing it after a send collapses the box back to one row.
$effect(() => {
  draft;
  autoGrow();
});

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
  // The files went into `fd` already; clear the picker so they are not sent twice.
  const picker = formEl.querySelector<HTMLInputElement>('input[type="file"]');
  if (picker) picker.value = '';
  fileNames = [];
  scrollDown(true); // the question, and the answer growing under it, stay in view
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
        // Only the parse is guarded — a partial line is normal, but a failure while APPLYING a
        // frame used to be swallowed here too, which stranded the bubble on "thinking" forever.
        type Frame = {
          choices?: { delta?: { content?: string } }[];
          dab?: { tool?: ToolChip; messages?: { user: string | null; assistant: string } };
          error?: { message?: string };
        };
        let j: Frame;
        try {
          j = JSON.parse(d) as Frame;
        } catch {
          continue; /* partial line */
        }
        if (j.error) {
          streamError = t('ai.chat.error');
          continue;
        }
        const stored = j.dab?.messages;
        if (stored) {
          // H-12: the pair is persisted — give the bubbles their real ids so Regenerate/Edit work.
          const n = messages.length;
          if (n >= 2 && stored.user)
            messages[n - 2] = { ...(messages[n - 2] as Msg), id: stored.user };
          if (n >= 1) messages[n - 1] = { ...(messages[n - 1] as Msg), id: stored.assistant };
          leafId = stored.assistant;
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
            messages[messages.length - 1] = { ...last, content: acc, html: await safeRender(acc) };
          scrollDown();
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
  // Warm the markdown renderer up front: its sanitiser is a dynamic import, and paying for that
  // load mid-stream is how a first reply gets lost (the dev server even re-optimises on discovery).
  void safeRender('');
  fitHeight();
  scrollDown(true); // open on the newest message, the way the conversation was left
  const onUnload = () => controller?.abort();
  window.addEventListener('beforeunload', onUnload);
  window.addEventListener('resize', fitHeight);
  return () => {
    window.removeEventListener('beforeunload', onUnload);
    window.removeEventListener('resize', fitHeight);
  };
});
function copy(text: string) {
  navigator.clipboard?.writeText(text);
}
</script>

<svelte:head><title>{t('ai.chat.title')}</title></svelte:head>

<!--
  One screenful, never more: the grid gets a definite height so both columns scroll inside
  themselves. Before this, a long conversation list stretched the row and pushed the composer off
  the bottom of the page. `fitHeight()` refines the CSS fallback below once JavaScript is up.
-->
<div bind:this={rootEl} id="ai-assistant-container" class="grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 lg:grid-cols-[18rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-4" style="height: calc(100dvh - 12rem); min-height: 24rem">
  <!-- Narrow screens trade the whole sidebar for a combobox + a new-conversation button (H-7). -->
  <div class="flex items-center gap-2 lg:hidden">
    <form method="GET" action="/m/ai/chat" class="min-w-0 flex-1">
      <label class="sr-only" for="conversation-picker">{t('ai.chat.pick')}</label>
      <select id="conversation-picker" name="c" value={data.conversation?.id ?? ''} class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}>
        <option value="" disabled>{data.conversations.length ? t('ai.chat.pick') : t('ai.chat.empty')}</option>
        {#each [['today', t('ai.chat.today')], ['yesterday', t('ai.chat.yesterday')], ['week', t('ai.chat.week')], ['older', t('ai.chat.older')]] as [key, label] (key)}
          {@const items = groups[key as keyof typeof groups]}
          {#if items.length}
            <optgroup {label}>
              {#each items as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
            </optgroup>
          {/if}
        {/each}
      </select>
      <!-- Without JavaScript the same select is a plain GET filter, one submit away. -->
      <noscript><Button type="submit" variant="outline" size="sm" class="mt-2 w-full">{t('ai.chat.open')}</Button></noscript>
    </form>
    <form method="POST" action="?/new"><Csrf token={data.csrf} /><Button type="submit" size="icon" class="shrink-0" title={t('ai.chat.new')} aria-label={t('ai.chat.new')}><Icon name="plus" size={18} /></Button></form>
  </div>

  <!-- sidebar (H-7) -->
  <aside id="conversation-list-sidebar" class="hidden min-h-0 flex-col gap-3 rounded-lg border bg-card p-3 lg:flex">
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
  <section id="message-container" class="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
    <header class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-3 py-2 sm:px-4">
      <h1 class="min-w-0 flex-1 truncate text-base font-semibold">{data.conversation?.title ?? t('ai.chat.title')}</h1>
      {#if data.conversation}
        <div class="flex flex-wrap items-center gap-1">
          {#if data.providers.length}
            <form method="POST" action="?/model" class="flex items-center gap-1" data-testid="model-picker">
              <Csrf token={data.csrf} /><input type="hidden" name="c" value={data.conversation.id} />
              <label class="sr-only" for="pm">{t('ai.chat.model')}</label>
              <select id="pm" name="pm" value={currentPick} class="h-8 max-w-36 rounded-md border border-input bg-background px-2 text-xs sm:max-w-56" onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}>
                <option value="default">{t('ai.chat.model_default')}</option>
                {#each data.providers as p (p.id)}
                  <optgroup label={p.recommended ? `${p.name} ★` : p.name}>
                    {#each p.models as m (m.model)}<option value={`${p.code}::${m.model}`}>{m.label ?? m.model}</option>{/each}
                  </optgroup>
                {/each}
              </select>
              <noscript><Button type="submit" variant="ghost" size="sm">{t('ai.chat.model_change')}</Button></noscript>
            </form>
            {#if pickedProvider?.capabilities}
              <Capabilities capabilities={pickedProvider.capabilities} recommended={pickedProvider.recommended} preferredEndpoint={pickedProvider.preferredEndpoint} compact />
            {/if}
          {/if}
          <!-- The labels fold away on narrow screens; the title stays readable, the actions stay reachable. -->
          <form method="POST" action="?/archive"><Csrf token={data.csrf} /><input type="hidden" name="c" value={data.conversation.id} /><input type="hidden" name="archived" value="1" /><Button id="btn-chat-archive" type="submit" variant="ghost" size="sm" title={t('ai.chat.archive')} aria-label={t('ai.chat.archive')}><Icon name="folder" size={14} /><span class="hidden sm:inline">{t('ai.chat.archive')}</span></Button></form>
          <form method="POST" action="?/delete"><Csrf token={data.csrf} /><input type="hidden" name="c" value={data.conversation.id} /><Button id="btn-chat-delete" type="submit" variant="ghost" size="sm" class="text-destructive" title={t('ai.chat.delete')} aria-label={t('ai.chat.delete')}><Icon name="trash" size={14} /><!-- span class="hidden sm:inline">{t('ai.chat.delete')}</span> --></Button></form>
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
    <div id="messages-list" bind:this={listEl} onscroll={onListScroll} class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4" data-testid="messages">
      {#each messages as m (m.id)}
        <article class={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`} data-role={m.role}>
          <div class={`max-w-[88%] rounded-lg px-3 py-2 sm:max-w-[80%] sm:px-4 ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
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
              {#if m.content && m.html}<div class="prose-chat">{@html m.html}</div>{:else if m.content}<p class="whitespace-pre-wrap">{m.content}</p>{:else}<span class="text-muted-foreground">{t('ai.chat.thinking')}</span>{/if}
              {#if m.content}
                <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" onclick={() => copy(m.content)}><Icon name="copy" size={12} />{t('ai.chat.copy')}</button>
                  {#if data.conversation && STORED.test(m.id) && !streaming}
                    <!-- H-12: a second answer to the same question becomes a sibling version -->
                    <form method="POST" action="?/regenerate" class="inline"><Csrf token={data.csrf} /><input type="hidden" name="c" value={data.conversation.id} /><input type="hidden" name="m" value={m.id} /><button type="submit" class="inline-flex items-center gap-1 hover:text-foreground" data-testid="regenerate"><Icon name="refresh" size={12} />{t('ai.chat.regenerate')}</button></form>
                    {@render versions(m.id)}
                  {/if}
                </div>
              {/if}
            {:else}
              <p class="whitespace-pre-wrap">{m.content}</p>
              {#if m.attachments?.length}
                <ul class="mt-2 flex flex-wrap gap-2" aria-label={t('ai.chat.attachments')} data-testid="attachments">
                  {#each m.attachments as att (att.id)}
                    <li>
                      {#if att.mime.startsWith('image/')}
                        <a href={att.url} target="_blank" rel="noopener"><img src={att.url} alt={att.name} class="max-h-32 rounded-md border border-primary-foreground/30" /></a>
                      {:else}
                        <a href={att.url} class="inline-flex items-center gap-1 rounded-md border border-primary-foreground/30 px-2 py-1 text-xs no-underline hover:bg-primary-foreground/10"><Icon name="file" size={12} />{att.name} <span class="opacity-70">({Math.ceil(att.size / 1024)} KB)</span></a>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if data.conversation && STORED.test(m.id) && !streaming}
                <div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-80">
                  <!-- H-12: editing makes a sibling of this message and a fresh branch below it -->
                  <details class="inline">
                    <summary class="inline-flex cursor-pointer list-none items-center gap-1 hover:opacity-100" data-testid="edit"><Icon name="edit" size={12} />{t('ai.chat.edit')}</summary>
                    <form method="POST" action="?/edit" class="mt-2 grid gap-2 text-foreground">
                      <Csrf token={data.csrf} /><input type="hidden" name="c" value={data.conversation.id} /><input type="hidden" name="m" value={m.id} />
                      <textarea name="content" required rows="3" class="min-h-16 w-64 max-w-full rounded-md border border-input bg-background px-2 py-1 text-sm">{m.content}</textarea>
                      <Button type="submit" size="sm" variant="secondary">{t('ai.chat.edit_send')}</Button>
                    </form>
                  </details>
                  {@render versions(m.id)}
                </div>
              {/if}
            {/if}
          </div>
        </article>
      {:else}
        <p class="py-12 text-center text-muted-foreground">{t('ai.chat.empty')}</p>
      {/each}
    </div>
    <form method="POST" action="?/send" enctype="multipart/form-data" data-stream="/m/ai/chat/stream" onsubmit={streamSend} class="shrink-0 border-t p-2 sm:p-3">
      <Csrf token={data.csrf} />
      <input type="hidden" name="c" value={data.conversation?.id ?? ''} />
      <input type="hidden" name="parent" value={leafId} />
      <!-- One pill carries the whole composer: attach on the left, the growing textarea, send on the right. -->
      <div id="chat-composer" class="flex items-end gap-1 rounded-3xl border border-input bg-background px-2 py-1.5 focus-within:border-ring">
        <!-- H-11: attachments ride in the same form; without JavaScript the action uploads them first -->
        <label id="files-upload-label" class="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground" title={t('ai.chat.attach_hint')}>
          <Icon name="plus" size={18} /><span class="sr-only">{t('ai.chat.attach')}</span>
          <!-- Hidden but real: clicking the label opens the picker natively, so no-JS keeps working. -->
          <input id="files-upload" type="file" name="files" multiple accept="image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,text/csv,application/json,.md,.txt,.csv,.json" class="sr-only" data-testid="attach" onchange={(e) => (fileNames = Array.from((e.currentTarget as HTMLInputElement).files ?? []).map((f) => f.name))} />
        </label>
        <textarea id="chat-input" name="content" bind:this={inputEl} bind:value={draft} required rows="1" placeholder={t('ai.chat.placeholder')} class="max-h-40 min-h-9 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground" oninput={autoGrow} onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit(); } }}></textarea>
        {#if streaming}
          <Button id="btn-send" type="button" variant="outline" size="icon" class="shrink-0 rounded-full" onclick={stop} title={t('ai.chat.stop')} aria-label={t('ai.chat.stop')}><Icon name="stop" size={16} /></Button>
        {:else}
          <Button id="btn-send" type="submit" size="icon" class="shrink-0 rounded-full" disabled={!data.aiEnabled} title={t('ai.chat.send')} aria-label={t('ai.chat.send')}><Icon name="send" size={16} /></Button>
        {/if}
      </div>
      {#if fileNames.length}
        <ul class="mt-2 flex flex-wrap gap-1 px-2 text-xs text-muted-foreground" aria-label={t('ai.chat.attachments')} data-testid="attach-names">
          {#each fileNames as n (n)}<li class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"><Icon name="file" size={12} />{n}</li>{/each}
        </ul>
      {/if}
    </form>
  </section>
</div>

{#snippet versions(id: string)}
  {@const v = versionOf(id)}
  {#if v && v.count > 1 && data.conversation}
    <span class="inline-flex items-center gap-1" data-testid="versions" aria-label={t('ai.chat.version', { index: v.index, count: v.count })}>
      {#if v.prev}<a href={`/m/ai/chat?c=${data.conversation.id}&m=${v.prev}`} class="no-underline hover:text-foreground" aria-label={t('ai.chat.prev_version')}>‹</a>{:else}<span class="opacity-40">‹</span>{/if}
      <span>{v.index}/{v.count}</span>
      {#if v.next}<a href={`/m/ai/chat?c=${data.conversation.id}&m=${v.next}`} class="no-underline hover:text-foreground" aria-label={t('ai.chat.next_version')}>›</a>{:else}<span class="opacity-40">›</span>{/if}
    </span>
  {/if}
{/snippet}

<style>
  :global(.prose-chat p) { margin: 0.25rem 0; }
  :global(.prose-chat pre.code-block) { position: relative; margin: 0.5rem 0; overflow-x: auto; border-radius: 0.5rem; background: var(--background); border: 1px solid var(--border); padding: 0.75rem; font-size: 0.85em; }
  :global(.prose-chat pre[data-lang]::before) { content: attr(data-lang); position: absolute; right: 0.5rem; top: 0.25rem; font-size: 0.7em; color: var(--muted-foreground); }
  :global(.prose-chat code:not(pre code)) { background: var(--background); padding: 0 0.3rem; border-radius: 0.25rem; }
  :global(.prose-chat ul), :global(.prose-chat ol) { padding-left: 1.25rem; }
  :global(.prose-chat a) { text-decoration: underline; }
</style>
