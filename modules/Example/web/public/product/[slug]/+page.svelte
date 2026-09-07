<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';

/** Product page with per-page SEO: title, description, canonical, Open Graph, JSON-LD (R-4). */
let { data } = $props();
const t = useT();
const locale = useLocale();
const p = $derived(data.product);
const money = (n: number, cur: string) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'id-ID', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 0,
  }).format(n);
const url = $derived(`${data.origin}/product/${p.slug}`);
const desc = $derived(p.summary ?? p.name);
const ld = $derived(
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: desc,
    url,
    brand: { '@type': 'Brand', name: data.brand },
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: p.currency,
      availability: 'https://schema.org/InStock',
      url,
    },
  }),
);
</script>

<svelte:head>
  <title>{p.name} — {data.brand}</title>
  <meta name="description" content={desc} />
  <link rel="canonical" href={url} />
  <meta property="og:type" content="product" />
  <meta property="og:title" content={`${p.name} — ${data.brand}`} />
  <meta property="og:description" content={desc} />
  <meta property="og:url" content={url} />
  {@html `<script type="application/ld+json">${ld}</script>`}
</svelte:head>

<article class="mx-auto grid max-w-6xl gap-12 px-4 py-12 md:grid-cols-2 md:items-start">
  <div class="relative aspect-[4/5] w-full overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/30 via-primary/10 to-accent shadow-sm">
    {#if p.imageUrl}
      <img src={p.imageUrl} alt={p.name} class="h-full w-full object-cover" />
    {:else}
      <span class="absolute -bottom-10 -right-4 select-none text-[16rem] font-semibold leading-none text-primary/15" aria-hidden="true">{p.name.trim().charAt(0).toUpperCase()}</span>
    {/if}
    {#if p.featured}<span class="absolute left-4 top-4 rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur">{t('example.products.badge')}</span>{/if}
  </div>
  <div class="md:sticky md:top-24">
    <nav class="text-sm text-muted-foreground" aria-label="Breadcrumb"><a href="/example" class="hover:text-foreground">{data.brand}</a> <span aria-hidden="true">/</span> <a href="/example#products" class="hover:text-foreground">{t('example.products.title')}</a></nav>
    <h1 class="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{p.name}</h1>
    {#if p.summary}<p class="mt-3 text-lg text-muted-foreground">{p.summary}</p>{/if}
    <div class="mt-6 flex flex-wrap items-baseline gap-x-2">
      <p class="text-3xl font-semibold tracking-tight" data-testid="price">{money(p.price, p.currency)}</p>
      <span class="text-sm text-muted-foreground">{t('example.products.per')}</span>
    </div>
    <ul class="mt-6 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
      <li class="flex items-center gap-2"><Icon name="clock" size={16} class="text-primary" />{t('example.trust.t3')}</li>
      <li class="flex items-center gap-2"><Icon name="sparkles" size={16} class="text-primary" />{t('example.trust.t1')}</li>
      <li class="flex items-center gap-2"><Icon name="shield" size={16} class="text-primary" />{t('example.trust.t2')}</li>
      <li class="flex items-center gap-2"><Icon name="check" size={16} class="text-primary" />{t('example.trust.t4')}</li>
    </ul>
    <div class="mt-8 flex flex-col gap-3 sm:flex-row">
      <Button href="/example#contact" size="lg" class="w-full rounded-full px-6 sm:w-auto">{t('example.product.order')}<Icon name="arrow-right" size={18} /></Button>
      <Button href="/example#products" size="lg" variant="outline" class="w-full rounded-full px-6 sm:w-auto"><Icon name="arrow-left" size={16} />{t('example.product.back')}</Button>
    </div>
    {#if p.description}<div class="prose-sm mt-10 max-w-none whitespace-pre-line border-t pt-8 text-foreground/90">{p.description}</div>{/if}
  </div>
</article>
