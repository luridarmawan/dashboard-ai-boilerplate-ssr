<script lang="ts">
import type { Snippet } from 'svelte';

/**
 * A page body with the typography of the public page: already-sanitised `html`, or `children`
 * (the visual editor mounts into it). Used by the public page, the preview AND the visual editor,
 * so all three look exactly like the published page.
 */
let {
  html = '',
  class: className = '',
  children,
}: { html?: string; class?: string; children?: Snippet } = $props();
</script>

<div class="pages-body text-foreground {className}" data-testid="pages-body">{#if children}{@render children()}{:else}{@html html}{/if}</div>

<style>
  /* Markdown output is plain tags with no classes; give them a readable rhythm. */
  .pages-body :global(:where(p, ul, ol, blockquote, pre, table)) { margin-block: 1rem; line-height: 1.75; }
  .pages-body :global(:where(h2, h3, h4, h5, h6)) { margin-block: 2rem 0.75rem; font-weight: 600; line-height: 1.3; }
  .pages-body :global(h2) { font-size: 1.5rem; }
  .pages-body :global(h3) { font-size: 1.25rem; }
  .pages-body :global(:where(ul)) { list-style: disc; padding-inline-start: 1.5rem; }
  .pages-body :global(:where(ol)) { list-style: decimal; padding-inline-start: 1.5rem; }
  .pages-body :global(a) { color: var(--primary); text-decoration: underline; }
  .pages-body :global(blockquote) { border-inline-start: 3px solid var(--border); padding-inline-start: 1rem; color: var(--muted-foreground); }
  .pages-body :global(code) { background: var(--muted); border-radius: 0.25rem; padding: 0.1rem 0.3rem; font-size: 0.9em; }
  .pages-body :global(pre) { background: var(--muted); border-radius: 0.5rem; padding: 1rem; overflow-x: auto; }
  .pages-body :global(pre code) { background: none; padding: 0; }
  .pages-body :global(img) { max-width: 100%; height: auto; border-radius: 0.5rem; }
  .pages-body :global(table) { border-collapse: collapse; }
  .pages-body :global(:where(th, td)) { border: 1px solid var(--border); padding: 0.4rem 0.6rem; }
  .pages-body :global(hr) { border-color: var(--border); margin-block: 2rem; }
  .pages-body > :global(:first-child) { margin-top: 0; }
  /* The visual editor (Milkdown/ProseMirror) inside a body. */
  .pages-body :global(.pages-visual) { min-height: 16rem; outline: none; }
  .pages-body :global(.pages-visual > :first-child) { margin-top: 0; }
  /* ProseMirror wraps list items and table cells in <p>; the rendered page does not. */
  .pages-body :global(.pages-visual :where(li, th, td) > p) { margin-block: 0; }
  .pages-body :global(.pages-visual .ProseMirror-selectednode) { outline: 2px solid var(--ring); }
</style>
