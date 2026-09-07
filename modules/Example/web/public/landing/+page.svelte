<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';

/**
 * Landing page of the Example module — a modern storefront. Rules it lives by (R-7): no literal
 * colours, only theme tokens (so all four themes and every module theme restyle it); no literal
 * copy, only i18n keys; everything server-rendered, nothing on the render path needs JavaScript
 * or an image request (the product "art" is drawn from tokens; a real image_url is used when set).
 */
let { data, form } = $props();
const t = useT();
const locale = useLocale();
const money = (n: number, cur: string) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'id-ID', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 0,
  }).format(n);
const title = $derived(`${data.brand} — ${t('example.hero.title')}`);
const description = $derived(data.tagline ?? t('example.hero.subtitle'));
const ld = $derived(
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: data.brand,
    url: `${data.origin}/`,
    description,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'sales',
      url: `${data.origin}/example#contact`,
    },
  }),
);
const features = ['f1', 'f2', 'f3'] as const;
const featureIcons = { f1: 'tag', f2: 'sparkles', f3: 'send' } as const;
const trust = [
  { k: 't1', icon: 'sparkles' },
  { k: 't2', icon: 'shield' },
  { k: 't3', icon: 'clock' },
  { k: 't4', icon: 'check' },
] as const;
const collections = ['c1', 'c2', 'c3', 'c4'] as const;
const plans = [
  { k: 'starter', price: 95000, hi: false },
  { k: 'regular', price: 175000, hi: true },
  { k: 'business', price: null, hi: false },
] as const;
const stats = ['stat1', 'stat2', 'stat3'] as const;
const planFeatures = ['f1', 'f2', 'f3'] as const;
/** Token-only product art: a rotating set of gradients so a grid never looks uniform. */
const art = [
  'from-primary/30 via-primary/10 to-accent',
  'from-secondary via-accent to-primary/20',
  'from-warning/40 via-accent to-background',
  'from-accent via-primary/15 to-secondary',
  'from-primary/20 via-background to-warning/30',
  'from-muted via-accent to-primary/25',
];
const artOf = (i: number) => art[i % art.length];
const initial = (name: string) => name.trim().charAt(0).toUpperCase();
const hero = $derived(data.products.slice(0, 3));
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={`${data.origin}/`} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={`${data.origin}/`} />
  <meta property="og:site_name" content={data.brand} />
  <meta name="twitter:card" content="summary" />
  {@html `<script type="application/ld+json">${ld}</script>`}
</svelte:head>

<!-- announcement bar -->
<div class="border-b bg-primary text-primary-foreground">
  <p class="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium tracking-wide"><Icon name="sparkles" size={14} />{t('example.bar.text')}</p>
</div>

<!-- hero -->
<section class="relative overflow-hidden">
  <div class="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" aria-hidden="true"></div>
  <div class="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-warning/15 blur-3xl" aria-hidden="true"></div>
  <div class="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-14 md:grid-cols-[1.1fr_1fr] md:items-center md:pt-24">
    <div>
      <p class="mb-5 inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground backdrop-blur"><span class="h-1.5 w-1.5 rounded-full bg-primary"></span>{t('example.hero.eyebrow')}</p>
      <h1 class="text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">{t('example.hero.title')}</h1>
      <p class="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">{data.tagline ?? t('example.hero.subtitle')}</p>
      <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button href="#products" size="lg" class="w-full rounded-full px-6 sm:w-auto">{t('example.hero.cta')}<Icon name="arrow-right" size={18} /></Button>
        <Button href="#contact" size="lg" variant="outline" class="w-full rounded-full px-6 sm:w-auto">{t('example.hero.cta2')}</Button>
      </div>
      <dl class="mt-10 grid max-w-lg grid-cols-3 divide-x divide-border">
        {#each stats as s (s)}
          <div class="px-4 first:pl-0">
            <dt class="text-2xl font-semibold tracking-tight text-foreground">{t(`example.hero.${s}.value`)}</dt>
            <dd class="mt-1 text-xs text-muted-foreground">{t(`example.hero.${s}.label`)}</dd>
          </div>
        {/each}
      </dl>
    </div>

    <!-- product mosaic: the three featured products, drawn from tokens -->
    <div class="relative mx-auto grid w-full max-w-md grid-cols-6 grid-rows-6 gap-3" style="aspect-ratio: 1 / 1.05" aria-hidden="true">
      {#if hero[0]}
        <div class={`col-span-4 row-span-4 rounded-3xl border bg-gradient-to-br ${artOf(0)} p-5 shadow-sm`}>
          <div class="flex h-full flex-col justify-between">
            <span class="text-7xl font-semibold leading-none text-primary/25">{initial(hero[0].name)}</span>
            <div><p class="font-semibold text-foreground">{hero[0].name}</p><p class="text-sm text-muted-foreground">{money(hero[0].price, hero[0].currency)}</p></div>
          </div>
        </div>
      {/if}
      {#if hero[1]}
        <div class={`col-span-2 row-span-3 rounded-3xl border bg-gradient-to-b ${artOf(1)} p-4 shadow-sm`}>
          <span class="text-4xl font-semibold text-primary/30">{initial(hero[1].name)}</span>
          <p class="mt-6 text-xs font-medium text-foreground">{hero[1].name}</p>
        </div>
      {/if}
      {#if hero[2]}
        <div class={`col-span-2 row-span-3 rounded-3xl border bg-gradient-to-t ${artOf(2)} p-4 shadow-sm`}>
          <span class="text-4xl font-semibold text-primary/30">{initial(hero[2].name)}</span>
          <p class="mt-6 text-xs font-medium text-foreground">{hero[2].name}</p>
        </div>
      {/if}
      <div class="col-span-4 row-span-2 flex items-center gap-3 rounded-3xl border bg-card p-4 shadow-sm">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"><Icon name="check" size={20} /></span>
        <div class="text-sm"><p class="font-medium text-foreground">{t('example.trust.t3')}</p><p class="text-muted-foreground">{t('example.trust.t1')}</p></div>
      </div>
      {#if !hero.length}
        <div class="col-span-6 row-span-6 rounded-3xl border bg-gradient-to-br from-primary/20 to-accent"></div>
      {/if}
    </div>
  </div>
</section>

<!-- trust strip -->
<section class="border-y bg-card/60">
  <ul class="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-4 px-4 py-5 text-sm md:grid-cols-4">
    {#each trust as x (x.k)}
      <li class="flex items-center gap-3 text-foreground"><span class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon name={x.icon} size={18} /></span>{t(`example.trust.${x.k}`)}</li>
    {/each}
  </ul>
</section>

<!-- collections -->
<section class="mx-auto max-w-6xl px-4 pt-16">
  <h2 class="text-2xl font-semibold tracking-tight">{t('example.collections.title')}</h2>
  <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {#each collections as c, i (c)}
      <a href="#products" class={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br ${artOf(i + 2)} p-5 no-underline transition-transform hover:-translate-y-0.5 hover:no-underline`}>
        <p class="text-lg font-semibold text-foreground">{t(`example.collections.${c}`)}</p>
        <p class="mt-1 text-sm text-muted-foreground">{t(`example.collections.${c}.text`)}</p>
        <span class="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary">{t('example.products.all')}<Icon name="arrow-right" size={14} class="transition-transform group-hover:translate-x-0.5" /></span>
      </a>
    {/each}
  </div>
</section>

<!-- featured products from the module's table -->
<section id="products" class="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h2 class="text-2xl font-semibold tracking-tight">{t('example.products.title')}</h2>
      <p class="mt-1 text-muted-foreground">{t('example.products.lead')}</p>
    </div>
    <span class="text-sm text-muted-foreground">{data.products.length} {t('example.widget.products')}</span>
  </div>
  {#if data.products.length}
    <ul class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="products">
      {#each data.products as p, i (p.id)}
        <li>
          <a href={`/product/${p.slug}`} class="group block h-full no-underline hover:no-underline">
            <article class="flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
              <div class={`relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br ${artOf(i)}`}>
                {#if p.imageUrl}
                  <img src={p.imageUrl} alt={p.name} loading="lazy" class="h-full w-full object-cover" />
                {:else}
                  <span class="absolute -bottom-6 -right-2 select-none text-[11rem] font-semibold leading-none text-primary/15" aria-hidden="true">{initial(p.name)}</span>
                {/if}
                {#if p.featured}<span class="absolute left-3 top-3 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur">{t('example.products.badge')}</span>{/if}
              </div>
              <div class="flex flex-1 flex-col p-5">
                <h3 class="font-semibold text-foreground">{p.name}</h3>
                {#if p.summary}<p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.summary}</p>{/if}
                <div class="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-1 pt-4">
                  <p class="text-foreground"><strong class="text-lg">{money(p.price, p.currency)}</strong><span class="text-xs text-muted-foreground">{t('example.products.per')}</span></p>
                  <span class="inline-flex items-center gap-1 text-sm font-medium text-primary">{t('example.products.view')}<Icon name="arrow-right" size={14} class="transition-transform group-hover:translate-x-0.5" /></span>
                </div>
              </div>
            </article>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-6 rounded-2xl border bg-card p-8 text-center text-muted-foreground">{t('example.products.empty')}</p>
  {/if}
</section>

<!-- story + features -->
<section class="bg-muted/40">
  <div class="mx-auto grid max-w-6xl gap-12 px-4 py-20 md:grid-cols-2 md:items-center">
    <div class="relative mx-auto aspect-[4/5] w-full max-w-sm overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/25 via-accent to-secondary shadow-sm" aria-hidden="true">
      <div class="absolute inset-x-10 bottom-10 top-16 rounded-2xl border border-primary/20 bg-background/60 backdrop-blur"></div>
      <div class="absolute bottom-10 left-1/2 h-44 w-32 -translate-x-1/2 rounded-b-[2rem] rounded-t-xl bg-primary shadow-lg"></div>
      <div class="absolute bottom-[13.5rem] left-1/2 h-6 w-40 -translate-x-1/2 rounded-full bg-primary/40"></div>
      <div class="absolute right-8 top-8 h-14 w-14 rounded-full bg-warning/70"></div>
    </div>
    <div>
      <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">{t('example.story.eyebrow')}</p>
      <h2 class="mt-3 text-3xl font-semibold leading-tight tracking-tight">{t('example.story.title')}</h2>
      <p class="mt-4 text-muted-foreground">{t('example.story.text')}</p>
      <ul class="mt-8 space-y-5">
        {#each features as f (f)}
          <li class="flex gap-4">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon name={featureIcons[f]} size={20} /></span>
            <div><h3 class="font-semibold">{t(`example.features.${f}.title`)}</h3><p class="mt-0.5 text-sm text-muted-foreground">{t(`example.features.${f}.text`)}</p></div>
          </li>
        {/each}
      </ul>
      <Button href="#contact" variant="link" class="mt-6 px-0">{t('example.story.cta')}<Icon name="arrow-right" size={16} /></Button>
    </div>
  </div>
</section>

<!-- testimonials -->
{#if data.testimonials.length}
  <section class="mx-auto max-w-6xl px-4 py-20">
    <div class="max-w-xl">
      <h2 class="text-2xl font-semibold tracking-tight">{t('example.testimonials.title')}</h2>
      <p class="mt-1 text-muted-foreground">{t('example.testimonials.lead')}</p>
    </div>
    <div class="mt-8 grid gap-5 md:grid-cols-3">
      {#each data.testimonials as x, i (x.id)}
        <blockquote class="flex flex-col rounded-2xl border bg-card p-6 shadow-sm">
          <div class="flex gap-0.5 text-warning" aria-hidden="true">{#each [1, 2, 3, 4, 5] as s (s)}<Icon name="star" size={14} />{/each}</div>
          <p class="mt-4 flex-1 text-foreground">“{x.quote}”</p>
          <footer class="mt-6 flex items-center gap-3 text-sm">
            <span class={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${artOf(i + 3)} font-semibold text-foreground`}>{initial(x.author)}</span>
            <div><strong class="block text-foreground">{x.author}</strong>{#if x.role}<span class="text-muted-foreground">{x.role}</span>{/if}</div>
          </footer>
        </blockquote>
      {/each}
    </div>
  </section>
{/if}

<!-- pricing -->
{#if data.showPricing}
  <section class="bg-muted/40">
    <div class="mx-auto max-w-6xl px-4 py-20">
      <div class="mx-auto max-w-xl text-center">
        <h2 class="text-2xl font-semibold tracking-tight">{t('example.pricing.title')}</h2>
        <p class="mt-1 text-muted-foreground">{t('example.pricing.lead')}</p>
      </div>
      <div class="mt-10 grid gap-5 md:grid-cols-3 md:items-stretch">
        {#each plans as plan (plan.k)}
          <div class={`relative flex flex-col rounded-2xl border p-6 shadow-sm ${plan.hi ? 'border-primary bg-card ring-2 ring-primary/30 md:-my-3 md:py-9' : 'bg-card'}`}>
            {#if plan.hi}<span class="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">{t('example.pricing.popular')}</span>{/if}
            <h3 class="text-lg font-semibold">{t(`example.pricing.${plan.k}`)}</h3>
            <p class="mt-3 flex flex-wrap items-baseline gap-x-1 text-3xl font-semibold tracking-tight sm:text-4xl">{plan.price === null ? t('example.pricing.contact') : money(plan.price, 'IDR')}{#if plan.price !== null}<span class="text-base font-normal text-muted-foreground">{t('example.pricing.per_month')}</span>{/if}</p>
            <p class="mt-2 text-sm text-muted-foreground">{t(`example.pricing.${plan.k}.text`)}</p>
            <ul class="mt-6 space-y-2 text-sm">
              {#each planFeatures as f (f)}
                <li class="flex items-center gap-2"><Icon name="check" size={16} class="text-success" />{t(`example.pricing.${plan.k}.${f}`)}</li>
              {/each}
            </ul>
            <Button href="#contact" class="mt-8 w-full rounded-full" variant={plan.hi ? 'default' : 'outline'}>{t('example.hero.cta2')}</Button>
          </div>
        {/each}
      </div>
    </div>
  </section>
{/if}

<!-- contact (no JavaScript needed) -->
<section id="contact" class="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
  <div class="grid gap-10 rounded-3xl border bg-card p-6 shadow-sm md:grid-cols-2 md:p-10">
    <div>
      <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">{t('example.contact.eyebrow')}</p>
      <h2 class="mt-3 text-3xl font-semibold tracking-tight">{t('example.contact.title')}</h2>
      <p class="mt-3 text-muted-foreground">{t('example.contact.lead')}</p>
      <p class="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground"><Icon name="clock" size={16} />{t('example.contact.hours')}</p>
    </div>
    <div>
      {#if form?.sent || data.sent}
        <p class="notice" role="status" data-testid="contact-sent">{t('example.contact.sent')}</p>
      {:else}
        {#if form?.error}<p class="error mb-4" role="alert">{form.error === 'rate_limited' ? t('example.contact.rate_limited') : t('example.contact.error')}</p>{/if}
        <form method="POST" action="/example?/contact#contact" class="grid gap-4">
          <Csrf token={data.csrf} />
          <!-- honeypot: hidden from people, irresistible to bots -->
          <div class="hidden" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off" /></label></div>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-1.5 text-sm font-medium">{t('example.contact.name')}<input name="name" required minlength="2" maxlength="191" value={form?.values?.name ?? ''} class="h-11 rounded-xl border border-input bg-background px-3 font-normal" /></label>
            <label class="grid gap-1.5 text-sm font-medium">{t('example.contact.email')}<input name="email" type="email" required maxlength="191" value={form?.values?.email ?? ''} class="h-11 rounded-xl border border-input bg-background px-3 font-normal" /></label>
          </div>
          <label class="grid gap-1.5 text-sm font-medium">{t('example.contact.message')}<textarea name="message" required minlength="10" maxlength="5000" rows="5" class="rounded-xl border border-input bg-background px-3 py-2 font-normal">{form?.values?.message ?? ''}</textarea></label>
          <div><Button type="submit" size="lg" class="rounded-full px-6"><Icon name="send" size={16} />{t('example.contact.send')}</Button></div>
        </form>
      {/if}
    </div>
  </div>
</section>

<p class="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted-foreground">{t('example.footer.text')}</p>
