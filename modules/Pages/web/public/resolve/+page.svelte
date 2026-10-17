<script lang="ts">
import MarkdownBody from '../../lib/MarkdownBody.svelte';

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
  <MarkdownBody html={p.html} class="mt-8" />
</article>

