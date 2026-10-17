<script lang="ts">
import { Img } from '@core/ui';
import MarkdownBody from '../../lib/MarkdownBody.svelte';

/**
 * A published page at the site root. The body arrives as sanitised HTML from the API; the
 * canonical URL is the page's own root URL, never `/pages` (the address this handler lives at).
 * The featured image leads the article and is the link preview on social networks: og:image with
 * its size, type and alt (so Facebook/LinkedIn draw the card on the first share), and a large
 * Twitter/X card. Without one, the share uses the site's default image ($lib/seo) — the article
 * itself shows no picture then; the default only illustrates the link.
 */
let { data } = $props();
const p = $derived(data.page);
const img = $derived(p.image);
const share = $derived(data.share);
const siteName = $derived((data as { app?: { name?: string } }).app?.name || '');
</script>

<svelte:head>
  <title>{p.title}</title>
  {#if p.summary}<meta name="description" content={p.summary} />{/if}
  <link rel="canonical" href={data.canonical} />
  <meta property="og:type" content="article" />
  <meta property="og:title" content={p.title} />
  {#if p.summary}<meta property="og:description" content={p.summary} />{/if}
  <meta property="og:url" content={data.canonical} />
  {#if siteName}<meta property="og:site_name" content={siteName} />{/if}
  <meta property="og:image" content={share.url} />
  {#if share.url.startsWith('https://')}<meta property="og:image:secure_url" content={share.url} />{/if}
  <meta property="og:image:type" content={share.mime} />
  {#if share.width && share.height}
    <meta property="og:image:width" content={String(share.width)} />
    <meta property="og:image:height" content={String(share.height)} />
  {/if}
  <meta property="og:image:alt" content={share.alt} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content={share.url} />
  <meta name="twitter:image:alt" content={share.alt} />
  <meta name="twitter:title" content={p.title} />
  {#if p.summary}<meta name="twitter:description" content={p.summary} />{/if}
</svelte:head>

<article class="mx-auto max-w-3xl px-4 py-12" data-testid="pages-article" data-slug={p.slug}>
  <header class="border-b pb-6">
    <h1 class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl" data-testid="pages-title">{p.title}</h1>
    {#if p.summary}<p class="mt-3 text-lg text-muted-foreground">{p.summary}</p>{/if}
  </header>
  {#if img}
    <!-- The LCP candidate: eager, high priority, its box reserved from the stored pixel size. -->
    <figure class="mt-8 overflow-hidden rounded-xl border bg-muted" data-testid="pages-featured">
      <Img src={img.url} alt={img.alt ?? ''} width={img.width ?? undefined} height={img.height ?? undefined} priority class="h-auto w-full object-cover" />
    </figure>
  {/if}
  <MarkdownBody html={p.html} class="mt-8" />
</article>

