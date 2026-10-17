<script lang="ts">
import { Button, Field, Icon } from '@core/ui';
import { useT } from '$lib/i18n';
import MarkdownBody from './MarkdownBody.svelte';
import VisualEditor from './VisualEditor.svelte';
import type { VisualTool } from './visual.ts';

/**
 * Markdown editor for the page body: a plain <textarea> (it is what the form posts, with or
 * without JavaScript) plus, once hydrated, a formatting toolbar and four views:
 *   visual  — WYSIWYG (Milkdown, ./visual.ts) editing the same Markdown; the default
 *   write   — the Markdown source
 *   preview — rendered with the SAME rules and typography as the public page
 *             (../../api/markdown-rules.ts + MarkdownBody)
 *   split   — source and preview side by side (wide screens)
 * Milkdown and the preview renderer are loaded on demand, so the editor costs nothing on first
 * paint. Markdown in the textarea stays the single source: every view reads it and writes it.
 * Without JavaScript the textarea is all there is, and it still saves.
 */
interface Props {
  name: string;
  id?: string;
  label: string;
  value?: string | null | undefined;
  error?: string | null | undefined;
  readonly?: boolean;
  rows?: number;
}
let {
  name,
  id = `f-${name}`,
  label,
  value = '',
  error = null,
  readonly = false,
  rows = 16,
}: Props = $props();
const t = useT();

type Mode = 'visual' | 'write' | 'preview' | 'split';
const MODES: readonly Mode[] = ['visual', 'write', 'preview', 'split'];
const MODE_KEY = 'pages.editor.mode';

/** What was typed since the page rendered; null = still the value `load` gave us. */
let edited = $state<string | null>(null);
const text = $derived(edited ?? value ?? '');
let textarea = $state<HTMLTextAreaElement | null>(null);
let hydrated = $state(false);
let mode = $state<Mode>('write');
let html = $state('');
let rendering = $state(false);
let visual = $state<ReturnType<typeof VisualEditor> | null>(null);
let visualReady = $state(false);
let visualFailed = $state(false);

$effect(() => {
  hydrated = true;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(MODE_KEY);
  } catch {
    // storage blocked (private window): keep the default
  }
  mode = readonly ? 'preview' : MODES.includes(saved as Mode) ? (saved as Mode) : 'visual';
});

function setMode(next: Mode) {
  if (next !== 'visual') visualReady = false;
  mode = next;
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch {
    // a convenience only
  }
}

// Re-render the preview while it is visible; typing in split view waits for a short pause.
$effect(() => {
  if (!hydrated || (mode !== 'preview' && mode !== 'split')) return;
  const src = text;
  let cancelled = false;
  rendering = true;
  const timer = setTimeout(
    async () => {
      const { renderPreview } = await import('./preview.ts');
      if (cancelled) return;
      html = renderPreview(src);
      rendering = false;
    },
    mode === 'split' ? 150 : 0,
  );
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
});

/** Toolbar in the visual view: forwarded to Milkdown (VisualEditor asks for link/image URLs). */
function runVisual(tool: VisualTool) {
  visual?.run(tool);
}

/** Write into the textarea the way typing would, so the form, the preview and undo all follow. */
function replace(start: number, end: number, insert: string, selStart: number, selEnd: number) {
  const ta = textarea;
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(start, end);
  // execCommand keeps the browser's undo stack; setRangeText is the fallback where it is gone.
  if (!document.execCommand?.('insertText', false, insert)) ta.setRangeText(insert, start, end);
  ta.setSelectionRange(selStart, selEnd);
  edited = ta.value;
}

/** `**bold**`, `_italic_`, `` `code` ``: wrap the selection, or a placeholder to type over. */
function wrap(before: string, after: string, placeholder: string) {
  const ta = textarea;
  if (!ta) return;
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const inner = v.slice(s, e) || placeholder;
  replace(s, e, `${before}${inner}${after}`, s + before.length, s + before.length + inner.length);
}

/** `## `, `- `, `1. `, `> `: prefix every line the selection touches (again = remove). */
function prefixLines(prefix: (i: number) => string, pattern: RegExp) {
  const ta = textarea;
  if (!ta) return;
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const start = v.lastIndexOf('\n', s - 1) + 1;
  const nl = v.indexOf('\n', e);
  const end = nl < 0 ? v.length : nl;
  const lines = v.slice(start, end).split('\n');
  const off = lines.every((l) => pattern.test(l));
  const next = lines
    .map((l, i) => (off ? l.replace(pattern, '') : prefix(i) + l.replace(pattern, '')))
    .join('\n');
  replace(start, end, next, start, start + next.length);
}

function link() {
  const ta = textarea;
  if (!ta) return;
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const label = v.slice(s, e) || t('pages.editor.link_text');
  const url = 'https://';
  const insert = `[${label}](${url})`;
  // Select the URL: it is the part that still has to be typed.
  replace(s, e, insert, s + label.length + 3, s + label.length + 3 + url.length);
}

const tools = $derived([
  {
    id: 'bold',
    label: t('pages.editor.bold'),
    glyph: 'B',
    glyphClass: 'font-bold',
    key: 'b',
    run: () => wrap('**', '**', t('pages.editor.bold')),
  },
  {
    id: 'italic',
    label: t('pages.editor.italic'),
    glyph: 'I',
    glyphClass: 'italic font-serif',
    key: 'i',
    run: () => wrap('_', '_', t('pages.editor.italic')),
  },
  {
    id: 'heading',
    label: t('pages.editor.heading'),
    glyph: 'H',
    glyphClass: 'font-semibold',
    key: '',
    run: () => prefixLines(() => '## ', /^#{1,6}\s/),
  },
  {
    id: 'quote',
    label: t('pages.editor.quote'),
    glyph: '❝',
    glyphClass: '',
    key: '',
    run: () => prefixLines(() => '> ', /^>\s?/),
  },
  {
    id: 'code',
    label: t('pages.editor.code'),
    glyph: '</>',
    glyphClass: 'font-mono text-xs',
    key: '',
    run: () => wrap('`', '`', 'code'),
  },
  {
    id: 'ul',
    label: t('pages.editor.bullets'),
    icon: 'list',
    key: '',
    run: () => prefixLines(() => '- ', /^[-*]\s/),
  },
  {
    id: 'ol',
    label: t('pages.editor.numbers'),
    glyph: '1.',
    glyphClass: 'font-mono text-xs',
    key: '',
    run: () => prefixLines((i) => `${i + 1}. `, /^\d+\.\s/),
  },
  { id: 'link', label: t('pages.editor.link'), icon: 'link', key: 'k', run: link },
  {
    id: 'image',
    label: t('pages.editor.image'),
    icon: 'image',
    key: '',
    run: () => wrap('![', '](https://)', t('pages.editor.image_alt')),
  },
] as {
  id: VisualTool;
  label: string;
  icon?: string;
  glyph?: string;
  glyphClass?: string;
  key: string;
  run: () => void;
}[]);

function shortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const tool = tools.find((x) => x.key && x.key === event.key.toLowerCase());
  if (!tool) return;
  event.preventDefault();
  tool.run();
}

/** One toolbar, two engines: Milkdown in the visual view, text edits on the source. */
function runTool(tool: { id: VisualTool; run: () => void }) {
  if (mode === 'visual') runVisual(tool.id);
  else tool.run();
}

const views = $derived([
  { id: 'visual' as const, label: t('pages.editor.visual'), icon: 'eye' },
  { id: 'write' as const, label: t('pages.editor.write'), icon: 'edit' },
  { id: 'preview' as const, label: t('pages.editor.preview'), icon: 'monitor' },
  { id: 'split' as const, label: t('pages.editor.split'), icon: 'columns' },
]);
</script>

<Field {label} for={id} {error} hint={t('pages.editor.hint')}>
  <div class="rounded-md border border-input bg-background" data-testid="pages-editor" data-mode={hydrated ? mode : null}>
    {#if hydrated}
      <!-- No overflow clipping on the frame: the slash menu may need to float past its edge. -->
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-t-md border-b bg-muted/40 px-2 py-1.5">
        <div class="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label={t('pages.editor.toolbar')}>
          {#if !readonly}
            {#each tools as tool (tool.id)}
              <button type="button" class="inline-flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-40" title={tool.key ? `${tool.label} (Ctrl+${tool.key.toUpperCase()})` : tool.label} aria-label={tool.label} disabled={mode === 'preview' || (mode === 'visual' && !visualReady)} onclick={() => runTool(tool)} data-tool={tool.id}>
                {#if tool.icon}<Icon name={tool.icon} size={16} />{:else}<span class={tool.glyphClass} aria-hidden="true">{tool.glyph}</span>{/if}
              </button>
            {/each}
          {/if}
        </div>
        <div class="flex items-center gap-0.5" role="group" aria-label={t('pages.editor.view')}>
          {#each views as v (v.id)}
            <Button type="button" size="sm" variant={mode === v.id ? 'secondary' : 'ghost'} aria-pressed={mode === v.id} onclick={() => setMode(v.id)} class={v.id === 'split' ? 'hidden lg:inline-flex' : ''} data-view={v.id}>
              <Icon name={v.icon} size={16} /><span class="hidden sm:inline">{v.label}</span>
            </Button>
          {/each}
        </div>
      </div>
    {/if}
    <div class={mode === 'split' ? 'grid lg:grid-cols-2' : ''}>
      {#if mode === 'visual' && visualFailed}<p class="border-b px-3 py-2 text-sm text-muted-foreground" role="status">{t('pages.editor.visual_failed')}</p>{/if}
      <!-- Always in the DOM: hidden in the visual and preview views, but it is what the form posts. -->
      <textarea
        bind:this={textarea}
        {id}
        {name}
        {rows}
        {readonly}
        value={text}
        oninput={(e) => (edited = e.currentTarget.value)}
        onkeydown={shortcut}
        aria-invalid={error ? 'true' : undefined}
        spellcheck="true"
        class="block w-full resize-y border-0 bg-transparent px-3 py-2 font-mono text-sm leading-6 focus-visible:outline-none {mode === 'preview' || (mode === 'visual' && !visualFailed) ? 'hidden' : ''} {mode === 'split' ? 'lg:border-e' : ''}"
      ></textarea>
      {#if hydrated && mode === 'visual' && !visualFailed}
        <div class="min-h-64 px-3 py-4 sm:px-5">
          <VisualEditor bind:this={visual} value={text} {label} {readonly} onchange={(md) => (edited = md)} onready={() => (visualReady = true)} onfail={() => (visualFailed = true)} />
        </div>
      {/if}
      {#if hydrated && (mode === 'preview' || mode === 'split')}
        <div class="max-h-[40rem] min-h-48 overflow-y-auto px-5 py-4" aria-live="polite" aria-busy={rendering} data-testid="pages-preview">
          {#if text.trim()}
            <MarkdownBody {html} />
          {:else}
            <p class="text-sm text-muted-foreground">{t('pages.editor.empty')}</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</Field>
