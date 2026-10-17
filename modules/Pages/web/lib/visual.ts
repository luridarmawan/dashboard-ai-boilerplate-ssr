import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import {
  commonmark,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { callCommand } from '@milkdown/kit/utils';
import '@milkdown/kit/prose/view/style/prosemirror.css';
import '@milkdown/kit/prose/tables/style/tables.css';

/**
 * The editor's "Visual" view: Milkdown (ProseMirror) editing the SAME Markdown the textarea holds.
 * Markdown stays the stored format, so the API, its renderer and every permalink rule are
 * untouched; this view only reads the text in and writes Markdown back out on every change.
 * Loaded on demand — none of it is in the dashboard's first load.
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

export interface VisualEditor {
  /** Apply a toolbar action; link and image take the URL (and the image its description). */
  run(tool: VisualTool, payload?: { url: string; alt?: string }): void;
  focus(): void;
  destroy(): Promise<void>;
}

export async function createVisual(
  root: HTMLElement,
  markdown: string,
  onChange: (markdown: string) => void,
  opts: { readonly: boolean; label: string },
): Promise<VisualEditor> {
  const editor = await Editor.make()
    .config((ctx) => {
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
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .create();

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
    focus() {
      editor.action((ctx) => ctx.get(editorViewCtx).focus());
    },
    async destroy() {
      await editor.destroy();
    },
  };
  return api;
}
