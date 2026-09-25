<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import Img from '$lib/components/Img.svelte';
import { useLocale, useT } from '$lib/i18n';
import ProductDetail from '../_lib/ProductDetail.svelte';

/**
 * What a root URL renders when this module is the tenant's 404 handler (F-11): a category
 * (masthead + the catalogue rows of its products) or a product (the shared detail). The
 * canonical URL is the root one — that is the address the visitor and the crawler both see.
 */
let { data } = $props();
const t = useT();
const locale = useLocale();
const url = $derived(`${data.origin}${data.path}`);
const money = (n: number, cur: string) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'id-ID', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 0,
  }).format(n);
const initial = (name: string) => name.trim().charAt(0).toUpperCase();
const hit = $derived(data.hit);
const categoryLd = $derived(
  hit.kind === 'category'
    ? JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${hit.category.name} — ${data.brand}`,
        url,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: hit.products.length,
          itemListElement: hit.products.map((p: { name: string; slug: string }, i: number) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: p.name,
            url: `${data.origin}/${p.slug}`,
          })),
        },
      })
    : '',
);
</script>

<!-- The product case sets its head inside ProductDetail; `<svelte:head>` may not sit in a block. -->
<svelte:head>
  {#if hit.kind === 'category'}
    <title>{hit.category.name} — {data.brand}</title>
    <meta name="description" content={hit.category.description ?? hit.category.name} />
    <link rel="canonical" href={url} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={`${hit.category.name} — ${data.brand}`} />
    <meta property="og:description" content={hit.category.description ?? hit.category.name} />
    <meta property="og:url" content={url} />
    {@html `<script type="application/ld+json">${categoryLd}</script>`}
  {/if}
</svelte:head>

{#if hit.kind === 'category'}
  <section class="border-b bg-card">
    <div class="mx-auto max-w-6xl px-4 py-10">
      <nav class="text-sm text-muted-foreground" aria-label="Breadcrumb"><a href="/example" class="hover:text-foreground">{data.brand}</a> <span aria-hidden="true">/</span> <a href="/catalog" class="hover:text-foreground">{t('example.resolve.all_products')}</a></nav>
      <p class="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-primary">{t('example.resolve.categories')}</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl" data-testid="category-title">{hit.category.name}</h1>
      {#if hit.category.description}<p class="mt-3 max-w-2xl text-muted-foreground">{hit.category.description}</p>{/if}
    </div>
  </section>

  <section class="mx-auto max-w-6xl px-4 py-8">
    <p class="text-sm text-muted-foreground" data-testid="category-count">{hit.products.length} {t('example.resolve.products_in')}</p>
    {#if hit.products.length}
      <ul class="mt-6 grid gap-3" data-testid="category-items">
        {#each hit.products as p (p.id)}
          <li>
            <!-- Root URL on purpose: while this module answers unknown URLs, `/<slug>` is the product's address. -->
            <a href={`/${p.slug}`} class="group flex items-center gap-4 rounded-2xl border bg-card p-3 no-underline transition-colors hover:bg-accent/40 hover:no-underline sm:p-4">
              <span class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-gradient-to-br from-primary/20 via-accent to-secondary text-2xl font-semibold text-primary/60">
                {#if p.imageUrl}<Img src={p.imageUrl} alt="" width={64} height={64} class="h-full w-full object-cover" />{:else}{initial(p.name)}{/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <strong class="font-semibold text-foreground">{p.name}</strong>
                  {#if p.featured}<span class="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{t('example.products.badge')}</span>{/if}
                </span>
                {#if p.summary}<span class="mt-0.5 line-clamp-1 block text-sm text-muted-foreground">{p.summary}</span>{/if}
              </span>
              <span class="shrink-0 text-end">
                <strong class="block text-foreground">{money(p.price, p.currency)}</strong>
                <span class="text-xs text-muted-foreground">{t('example.products.per')}</span>
              </span>
              <Icon name="chevron-right" size={18} class="shrink-0 text-muted-foreground rtl:rotate-180" />
            </a>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="mt-6 rounded-2xl border bg-card p-8 text-center text-muted-foreground" data-testid="category-empty">{t('example.resolve.empty')}</p>
    {/if}
  </section>

  <p class="mx-auto max-w-6xl px-4 py-8 text-xs text-muted-foreground">{t('example.footer.text')}</p>
{:else}
  <ProductDetail
    product={hit.product}
    brand={data.brand}
    {url}
    crumbs={hit.category ? [{ href: `/${hit.category.slug}`, label: hit.category.name }] : []}
  />
{/if}
