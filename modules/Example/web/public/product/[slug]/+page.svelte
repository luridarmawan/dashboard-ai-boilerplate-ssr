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

<article class="mx-auto grid max-w-5xl gap-10 px-4 py-12 md:grid-cols-2">
  <div class="aspect-square w-full rounded-2xl border bg-primary/10" aria-hidden="true"></div>
  <div>
    <a href="/example#products" class="inline-flex items-center gap-1 text-sm"><Icon name="arrow-left" size={14} />{t('example.product.back')}</a>
    <h1 class="mt-3 text-3xl font-semibold">{p.name}</h1>
    {#if p.summary}<p class="mt-2 text-lg text-muted-foreground">{p.summary}</p>{/if}
    <p class="mt-4 text-2xl font-semibold" data-testid="price">{money(p.price, p.currency)}</p>
    {#if p.description}<div class="mt-6 whitespace-pre-line text-foreground/90">{p.description}</div>{/if}
    <div class="mt-8"><Button href="/example#contact" size="lg">{t('example.product.order')}<Icon name="arrow-right" size={18} /></Button></div>
  </div>
</article>
