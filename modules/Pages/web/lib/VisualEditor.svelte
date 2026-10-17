<script lang="ts">
import { Icon } from '@core/ui';
import { untrack } from 'svelte';
import { useT } from '$lib/i18n';
import MarkdownBody from './MarkdownBody.svelte';
import type { SlashBlock, VisualEditor, VisualTool } from './visual.ts';

/**
 * The visual (WYSIWYG) view of the page editor: Milkdown mounted in the public page's typography,
 * plus the Notion-like menus — `/` block menu, block handle (+ and drag), selection toolbar.
 * This component owns the markup (theme tokens, i18n, a11y); ./visual.ts owns the behaviour and
 * positions these elements. Markdown in, Markdown out through `onchange`.
 */
interface Props {
  /** Markdown to start from; read once — later edits flow out through `onchange`. */
  value: string;
  label: string;
  readonly?: boolean;
  onchange: (markdown: string) => void;
  /** Milkdown is up: the parent's toolbar may drive it now. */
  onready?: () => void;
  /** Milkdown could not be loaded; the parent falls back to the source view. */
  onfail?: () => void;
}
let { value, label, readonly = false, onchange, onready, onfail }: Props = $props();
const t = useT();

let root = $state<HTMLElement | null>(null);
let mount = $state<HTMLElement | null>(null);
let slashEl = $state<HTMLElement | null>(null);
let blockEl = $state<HTMLElement | null>(null);
let tooltipEl = $state<HTMLElement | null>(null);
let editor: VisualEditor | null = null;
let ready = $state(false);

/** Ask for an address with the browser's own prompt; null when cancelled or left as the stub. */
function ask(key: 'pages.editor.link_prompt' | 'pages.editor.image_prompt'): string | null {
  const url = window.prompt(t(key), 'https://')?.trim();
  return url && url !== 'https://' ? url : null;
}

// ---- slash menu ------------------------------------------------------------------------------
const BLOCKS = $derived([
  {
    id: 'text',
    icon: null,
    glyph: '¶',
    label: t('pages.slash.text'),
    words: 'text paragraph teks paragraf',
  },
  {
    id: 'h2',
    icon: null,
    glyph: 'H2',
    label: t('pages.slash.h2'),
    words: 'heading subjudul judul h2',
  },
  {
    id: 'h3',
    icon: null,
    glyph: 'H3',
    label: t('pages.slash.h3'),
    words: 'heading subjudul judul h3',
  },
  {
    id: 'ul',
    icon: 'list',
    glyph: '',
    label: t('pages.slash.ul'),
    words: 'bullet list daftar poin ul',
  },
  {
    id: 'ol',
    icon: null,
    glyph: '1.',
    label: t('pages.slash.ol'),
    words: 'numbered list daftar nomor ol',
  },
  {
    id: 'quote',
    icon: null,
    glyph: '❝',
    label: t('pages.slash.quote'),
    words: 'quote kutipan blockquote',
  },
  {
    id: 'codeblock',
    icon: null,
    glyph: '</>',
    label: t('pages.slash.codeblock'),
    words: 'code kode blok pre',
  },
  { id: 'table', icon: 'grid', glyph: '', label: t('pages.slash.table'), words: 'table tabel' },
  {
    id: 'hr',
    icon: 'minus',
    glyph: '',
    label: t('pages.slash.hr'),
    words: 'divider separator garis pemisah hr',
  },
  {
    id: 'image',
    icon: 'image',
    glyph: '',
    label: t('pages.slash.image'),
    words: 'image gambar foto img',
  },
] as { id: SlashBlock; icon: string | null; glyph: string; label: string; words: string }[]);
let query = $state<string | null>(null);
let active = $state(0);
const matches = $derived(
  query === null
    ? []
    : BLOCKS.filter((b) => {
        const q = (query ?? '').toLowerCase();
        return !q || b.label.toLowerCase().includes(q) || b.words.includes(q);
      }),
);

function choose(kind: SlashBlock) {
  if (!editor) return;
  if (kind === 'image') {
    const url = ask('pages.editor.image_prompt');
    if (!url) return editor.focus();
    editor.insertBlock(kind, { url, alt: t('pages.editor.image_alt') });
    return;
  }
  editor.insertBlock(kind);
}

function slashKey(event: KeyboardEvent): boolean {
  if (event.key === 'Escape') {
    editor?.closeSlash();
    return true;
  }
  if (!matches.length) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const step = event.key === 'ArrowDown' ? 1 : -1;
    active = (active + step + matches.length) % matches.length;
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    const pick = matches[active];
    if (pick) choose(pick.id);
    return true;
  }
  return false;
}

// ---- selection toolbar -------------------------------------------------------------------------
const MARKS = $derived([
  { id: 'bold', glyph: 'B', glyphClass: 'font-bold', label: t('pages.editor.bold') },
  { id: 'italic', glyph: 'I', glyphClass: 'italic font-serif', label: t('pages.editor.italic') },
  { id: 'code', glyph: '</>', glyphClass: 'font-mono text-xs', label: t('pages.editor.code') },
  { id: 'link', glyph: '', glyphClass: '', label: t('pages.editor.link') },
] as { id: VisualTool; glyph: string; glyphClass: string; label: string }[]);

/** Toolbar actions from the parent (the bar above the editor) and from the selection toolbar. */
export function run(tool: VisualTool) {
  if (!editor) return;
  if (tool === 'link' || tool === 'image') {
    const url = ask(tool === 'link' ? 'pages.editor.link_prompt' : 'pages.editor.image_prompt');
    if (!url) return editor.focus();
    editor.run(tool, { url, alt: t('pages.editor.image_alt') });
    return;
  }
  editor.run(tool);
}

// ---- lifecycle ---------------------------------------------------------------------------------
$effect(() => {
  if (!mount || !root || !slashEl || !blockEl || !tooltipEl) return;
  const target = mount;
  const menus = {
    root,
    slash: slashEl,
    block: blockEl,
    tooltip: tooltipEl,
    onSlash: (q: string | null) => {
      if (q !== query) active = 0;
      query = q;
    },
    onSlashKey: slashKey,
  };
  // Read once, untracked: the editor's own edits come back through `onchange` and must not
  // recreate it.
  const initial = untrack(() => value);
  let alive = true;
  let created: VisualEditor | null = null;
  ready = false;
  import('./visual.ts')
    .then(({ createVisual }) =>
      createVisual(target, initial, (md) => onchange(md), { readonly, label, menus }),
    )
    .then((e) => {
      if (!alive) return void e.destroy();
      created = e;
      editor = e;
      ready = true;
      onready?.();
    })
    .catch(() => {
      if (alive) onfail?.();
    });
  return () => {
    alive = false;
    editor = null;
    query = null;
    void created?.destroy();
    target.replaceChildren();
  };
});
</script>

<div bind:this={root} class="pages-visual-root relative" aria-busy={!ready}>
  {#if !ready}<p class="text-sm text-muted-foreground">{t('pages.editor.loading')}</p>{/if}
  <MarkdownBody><div bind:this={mount}></div></MarkdownBody>

  <!-- Floating pieces. visual.ts moves and shows them (data-show); they start hidden. -->
  <div bind:this={slashEl} class="pages-float z-30 w-64 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg" data-show="false" data-testid="pages-slash">
    {#if matches.length}
      <p class="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{t('pages.slash.title')}</p>
      <ul role="listbox" aria-label={t('pages.slash.title')} class="max-h-60 overflow-y-auto">
        {#each matches as b, i (b.id)}
          <li role="option" aria-selected={i === active}>
            <!-- mousedown keeps the editor's selection: the block lands where the `/` was typed. -->
            <button type="button" class="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-start text-sm {i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}" onmousedown={(e) => e.preventDefault()} onmouseenter={() => (active = i)} onclick={() => choose(b.id)} data-block={b.id}>
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-background text-xs font-semibold text-muted-foreground" aria-hidden="true">
                {#if b.icon}<Icon name={b.icon} size={14} />{:else}{b.glyph}{/if}
              </span>
              {b.label}
            </button>
          </li>
        {/each}
      </ul>
    {:else if query !== null}
      <p class="px-2 py-1.5 text-sm text-muted-foreground">{t('pages.slash.none')}</p>
    {/if}
  </div>

  <div bind:this={blockEl} class="pages-float z-20 flex items-center gap-0.5 text-muted-foreground" data-show="false" data-testid="pages-block-handle">
    <button type="button" class="flex h-6 w-6 items-center justify-center rounded hover:bg-accent hover:text-foreground" title={t('pages.block.add')} aria-label={t('pages.block.add')} onmousedown={(e) => e.preventDefault()} onclick={() => editor?.addBlockBelow()} data-testid="pages-block-add">
      <Icon name="plus" size={16} />
    </button>
    <span class="flex h-6 w-5 cursor-grab items-center justify-center rounded hover:bg-accent hover:text-foreground active:cursor-grabbing" title={t('pages.block.drag')} aria-hidden="true">
      <Icon name="more-vertical" size={16} />
    </span>
  </div>

  <div bind:this={tooltipEl} class="pages-float z-30 flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg" data-show="false" role="toolbar" aria-label={t('pages.editor.toolbar')} data-testid="pages-selection-bar">
    {#each MARKS as m (m.id)}
      <button type="button" class="inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm hover:bg-accent" title={m.label} aria-label={m.label} onmousedown={(e) => e.preventDefault()} onclick={() => run(m.id)} data-mark={m.id}>
        {#if m.id === 'link'}<Icon name="link" size={15} />{:else}<span class={m.glyphClass} aria-hidden="true">{m.glyph}</span>{/if}
      </button>
    {/each}
  </div>
</div>

<style>
  /* Positioned by floating-ui inside `.pages-visual-root`; hidden until a provider shows it. */
  .pages-float { position: absolute; top: 0; left: 0; }
  /* Hidden with visibility, not display: floating-ui measures the element while it is still
     hidden, and a `display: none` element has no offsetParent — it would be placed as if the
     page, not this root, were its frame. */
  .pages-float[data-show='false'] { visibility: hidden; pointer-events: none; }
  /* Room for the block handle to the left of every block. */
  .pages-visual-root :global(.pages-visual) { padding-inline-start: 3.75rem; }
  .pages-visual-root :global(.pages-visual[data-dragging='true']) { cursor: grabbing; }
</style>
