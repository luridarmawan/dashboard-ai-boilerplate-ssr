import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { BlockProvider, block } from '@milkdown/kit/plugin/block';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { SlashProvider, slashFactory } from '@milkdown/kit/plugin/slash';
import { TooltipProvider, tooltipFactory } from '@milkdown/kit/plugin/tooltip';
import {
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { gfm, insertTableCommand } from '@milkdown/kit/preset/gfm';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose, callCommand } from '@milkdown/kit/utils';
import '@milkdown/kit/prose/view/style/prosemirror.css';
import '@milkdown/kit/prose/tables/style/tables.css';

/**
 * The editor's "Visual" view: Milkdown (ProseMirror) editing the SAME Markdown the textarea holds.
 * Markdown stays the stored format, so the API, its renderer and every permalink rule are
 * untouched; this view only reads the text in and writes Markdown back out on every change.
 * Loaded on demand — none of it is in the dashboard's first load.
 *
 * On top of plain editing it adds the Notion-like trio, built from @milkdown/kit's headless
 * plugins with our own markup (VisualEditor.svelte), so they follow the theme and i18n:
 *   - slash menu    — `/` at the start of a paragraph lists block types; typing filters
 *   - block handle  — `+` (new block below, opens the slash menu) and ⋮⋮ (drag to move)
 *   - selection bar — bold / italic / code / link over selected text
 * The slash menu only offers blocks the public page renders (see api/markdown-rules.ts), so the
 * editor never shows anything visitors would not see.
 *
 * Milkdown re-serialises what it edits in its own style (`*` for emphasis, `*` bullets, escaped
 * characters), so the text may change shape after an edit here; it never changes meaning.
 * Merely opening the view writes nothing back — only a real edit does.
 */
export type VisualTool =
  | 'bold'
  | 'italic'
  | 'heading'
  | 'quote'
  | 'code'
  | 'ul'
  | 'ol'
  | 'link'
  | 'image';

/** Block types the slash menu can insert — each one renders on the public page. */
export type SlashBlock =
  | 'text'
  | 'h2'
  | 'h3'
  | 'ul'
  | 'ol'
  | 'quote'
  | 'codeblock'
  | 'table'
  | 'hr'
  | 'image';

export interface VisualMenus {
  /** Positioned ancestor the floating elements are placed in. */
  readonly root: HTMLElement;
  readonly slash: HTMLElement;
  readonly block: HTMLElement;
  readonly tooltip: HTMLElement;
  /** The slash query changed: the text after `/`, or null when the menu closes. */
  onSlash(query: string | null): void;
  /** A key while the slash menu is open; return true when the menu used it. */
  onSlashKey(event: KeyboardEvent): boolean;
}

export interface VisualEditor {
  /** Apply a toolbar action; link and image take the URL (and the image its description). */
  run(tool: VisualTool, payload?: { url: string; alt?: string }): void;
  /** Replace the `/query` the user typed with the chosen block. */
  insertBlock(kind: SlashBlock, payload?: { url: string; alt?: string }): void;
  /** Close the slash menu until the paragraph changes shape. */
  closeSlash(): void;
  /** The handle's `+`: an empty paragraph below the hovered block, slash menu open. */
  addBlockBelow(): void;
  focus(): void;
  destroy(): Promise<void>;
}

/** `/` then up to 24 non-space characters, at the very start of a paragraph. */
const SLASH_QUERY = /^\/([^\s/]{0,24})$/u;

export async function createVisual(
  root: HTMLElement,
  markdown: string,
  onChange: (markdown: string) => void,
  opts: { readonly: boolean; label: string; menus?: VisualMenus | undefined },
): Promise<VisualEditor> {
  const menus = opts.readonly ? undefined : opts.menus;
  const slash = slashFactory('pages');
  const tooltip = tooltipFactory('pages');
  let slashProvider: SlashProvider | null = null;
  let blockProvider: BlockProvider | null = null;
  /** Paragraph text the user closed the menu on (Escape); it stays closed until that changes. */
  let dismissed: string | null = null;
  let slashOpen = false;

  const setSlash = (query: string | null) => {
    slashOpen = query !== null;
    menus?.onSlash(query);
  };

  /** While the slash menu is open, its keys (arrows, Enter, Escape) are not the editor's. */
  const slashKeys = $prose(
    () =>
      new Plugin({
        props: {
          handleKeyDown: (_view, event) => (slashOpen && menus ? menus.onSlashKey(event) : false),
        },
      }),
  );

  let editor = Editor.make().config((ctx) => {
    ctx.set(rootCtx, root);
    ctx.set(defaultValueCtx, markdown);
    ctx.update(editorViewOptionsCtx, (prev) => ({
      ...prev,
      editable: () => !opts.readonly,
      attributes: {
        class: 'pages-visual',
        'aria-label': opts.label,
        'aria-multiline': 'true',
        role: 'textbox',
        'data-testid': 'pages-visual',
      },
    }));
    ctx.get(listenerCtx).markdownUpdated((_ctx, next, prev) => {
      if (next !== prev) onChange(next);
    });
    if (menus) configureMenus(ctx, menus);
  });

  function configureMenus(ctx: Ctx, m: VisualMenus) {
    ctx.set(slash.key, {
      view: () => {
        const provider = new SlashProvider({
          content: m.slash,
          root: m.root,
          debounce: 20,
          offset: 6,
          shouldShow(view: EditorView) {
            const text = provider.getContent(view) ?? null;
            const match = text === null ? null : SLASH_QUERY.exec(text);
            if (!match || text === dismissed) {
              if (text !== dismissed) dismissed = null;
              setSlash(null);
              return false;
            }
            setSlash(match[1] ?? '');
            return true;
          },
        });
        provider.onHide = () => setSlash(null);
        slashProvider = provider;
        return {
          update: (view: EditorView, prev: Parameters<SlashProvider['update']>[1]) =>
            provider.update(view, prev),
          destroy: () => provider.destroy(),
        };
      },
    });
    ctx.set(tooltip.key, {
      view: () => {
        const provider = new TooltipProvider({ content: m.tooltip, root: m.root, offset: 8 });
        return {
          update: (view: EditorView, prev: Parameters<TooltipProvider['update']>[1]) =>
            provider.update(view, prev),
          destroy: () => provider.destroy(),
        };
      },
    });
    ctx.set(block.key, {
      view: () => {
        const provider = new BlockProvider({
          ctx,
          content: m.block,
          root: m.root,
          getOffset: () => 8,
          getPlacement: () => 'left-start',
        });
        blockProvider = provider;
        // The provider binds itself on its first update, which otherwise waits for the first
        // transaction: without this, hovering a freshly opened page shows no handle.
        provider.update();
        return { update: () => provider.update(), destroy: () => provider.destroy() };
      },
    });
  }

  editor = editor.use(commonmark).use(gfm).use(history).use(listener);
  if (menus) editor = editor.use(slash).use(tooltip).use(block).use(slashKeys);
  await editor.create();

  const view = () => editor.ctx.get(editorViewCtx);
  const call = (...args: Parameters<typeof callCommand>) => editor.action(callCommand(...args));

  const api: VisualEditor = {
    run(tool, payload) {
      if (tool === 'bold') call(toggleStrongCommand.key);
      else if (tool === 'italic') call(toggleEmphasisCommand.key);
      else if (tool === 'heading') call(wrapInHeadingCommand.key, 2);
      else if (tool === 'quote') call(wrapInBlockquoteCommand.key);
      else if (tool === 'code') call(toggleInlineCodeCommand.key);
      else if (tool === 'ul') call(wrapInBulletListCommand.key);
      else if (tool === 'ol') call(wrapInOrderedListCommand.key);
      else if (tool === 'link' && payload) call(toggleLinkCommand.key, { href: payload.url });
      else if (tool === 'image' && payload)
        call(insertImageCommand.key, { src: payload.url, alt: payload.alt ?? '' });
      api.focus();
    },
    insertBlock(kind, payload) {
      const v = view();
      const { $from } = v.state.selection;
      // Remove the `/query` first; the command then shapes the (now empty) paragraph.
      const typed = $from.parent.textBetween(0, $from.parentOffset);
      if (SLASH_QUERY.test(typed))
        v.dispatch(v.state.tr.delete($from.pos - typed.length, $from.pos));
      dismissed = null;
      slashProvider?.hide();
      if (kind === 'text') call(turnIntoTextCommand.key);
      else if (kind === 'h2') call(wrapInHeadingCommand.key, 2);
      else if (kind === 'h3') call(wrapInHeadingCommand.key, 3);
      else if (kind === 'ul') call(wrapInBulletListCommand.key);
      else if (kind === 'ol') call(wrapInOrderedListCommand.key);
      else if (kind === 'quote') call(wrapInBlockquoteCommand.key);
      else if (kind === 'codeblock') call(createCodeBlockCommand.key);
      else if (kind === 'table') call(insertTableCommand.key, { row: 3, col: 2 });
      else if (kind === 'hr') call(insertHrCommand.key);
      else if (kind === 'image' && payload)
        call(insertImageCommand.key, { src: payload.url, alt: payload.alt ?? '' });
      api.focus();
    },
    closeSlash() {
      const v = view();
      const { $from } = v.state.selection;
      dismissed = $from.parent.textBetween(0, $from.parentOffset);
      slashProvider?.hide();
      setSlash(null);
    },
    addBlockBelow() {
      const active = blockProvider?.active;
      const v = view();
      if (!active) return;
      const { schema } = v.state;
      const paragraph = schema.nodes.paragraph;
      if (!paragraph) return;
      let tr = v.state.tr;
      let cursor: number;
      if (active.node.type === paragraph && active.node.content.size === 0) {
        // An empty paragraph is already the new block: just start the slash command in it.
        cursor = active.$pos.pos + 1;
        tr = tr.insertText('/', cursor);
      } else {
        const at = active.$pos.pos + active.node.nodeSize;
        tr = tr.insert(at, paragraph.create(null, schema.text('/')));
        cursor = at + 1;
      }
      tr = tr.setSelection(TextSelection.create(tr.doc, cursor + 1));
      v.dispatch(tr.scrollIntoView());
      v.focus();
    },
    focus() {
      view().focus();
    },
    async destroy() {
      await editor.destroy();
    },
  };
  return api;
}
