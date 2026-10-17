<script lang="ts">
/**
 * A published page at the site root. The body arrives as sanitised HTML from the API; the
 * canonical URL is the page's own root URL, never `/pages` (the address this handler lives at).
 */
let { data } = $props();
const p = $derived(data.page);
</script>

<svelte:head>
  <title>{p.title}</title>
  {#if p.summary}<meta name="description" content={p.summary} />{/if}
  <link rel="canonical" href={data.canonical} />
  <meta property="og:type" content="article" />
  <meta property="og:title" content={p.title} />
  {#if p.summary}<meta property="og:description" content={p.summary} />{/if}
  <meta property="og:url" content={data.canonical} />
</svelte:head>

<article class="mx-auto max-w-3xl px-4 py-12" data-testid="pages-article" data-slug={p.slug}>
  <header class="border-b pb-6">
    <h1 class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl" data-testid="pages-title">{p.title}</h1>
    {#if p.summary}<p class="mt-3 text-lg text-muted-foreground">{p.summary}</p>{/if}
  </header>
  <div class="pages-body mt-8 text-foreground">{@html p.html}</div>
</article>

<style>
  /* Markdown output is plain tags with no classes; give them a readable rhythm. */
  .pages-body :global(:where(p, ul, ol, blockquote, pre, table)) { margin-block: 1rem; line-height: 1.75; }
  .pages-body :global(:where(h2, h3, h4)) { margin-block: 2rem 0.75rem; font-weight: 600; line-height: 1.3; }
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
  .pages-body :global(:where(th, td)) { border: 1px solid var(--border); padding: 0.4rem 0.6rem; }
</style>
