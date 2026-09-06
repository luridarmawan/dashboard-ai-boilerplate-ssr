<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button, Card } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';

/**
 * Landing page of the Example module. Rules it lives by (R-7): no literal colours — only theme
 * tokens (Tailwind classes bound to them); no literal copy — only i18n keys. Everything is SSR.
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
const icons = { f1: 'sparkles', f2: 'clock', f3: 'send' } as const;
const plans = [
  { k: 'starter', price: 95000, hi: false },
  { k: 'regular', price: 175000, hi: true },
  { k: 'business', price: null, hi: false },
] as const;
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

<!-- hero -->
<section class="bg-gradient-to-b from-accent/60 to-background">
  <div class="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-12 md:grid-cols-2 md:items-center md:pt-20">
    <div>
      <p class="mb-3 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground"><Icon name="database" size={14} />{t('example.hero.badge')}</p>
      <h1 class="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">{t('example.hero.title')}</h1>
      <p class="mt-4 max-w-prose text-lg text-muted-foreground">{data.tagline ?? t('example.hero.subtitle')}</p>
      <div class="mt-6 flex flex-wrap gap-3">
        <Button href="#products" size="lg">{t('example.hero.cta')}<Icon name="arrow-right" size={18} /></Button>
        <Button href="#contact" size="lg" variant="outline">{t('example.hero.cta2')}</Button>
      </div>
    </div>
    <div class="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-sm" aria-hidden="true">
      <!-- Illustration built from tokens only (no image request on the render path, §7). -->
      <div class="absolute inset-x-8 bottom-8 top-10 rounded-xl bg-primary/10"></div>
      <div class="absolute bottom-8 left-1/2 h-40 w-28 -translate-x-1/2 rounded-b-3xl rounded-t-lg bg-primary"></div>
      <div class="absolute bottom-48 left-1/2 h-6 w-36 -translate-x-1/2 rounded-full bg-primary/40"></div>
      <div class="absolute right-10 top-10 h-16 w-16 rounded-full bg-warning/70"></div>
    </div>
  </div>
</section>

<!-- features -->
<section class="mx-auto max-w-6xl px-4 py-16">
  <h2 class="text-2xl font-semibold">{t('example.features.title')}</h2>
  <div class="mt-6 grid gap-4 md:grid-cols-3">
    {#each features as f (f)}
      <Card>
        <Icon name={icons[f]} class="text-primary" size={24} />
        <h3 class="mt-3 font-semibold">{t(`example.features.${f}.title`)}</h3>
        <p class="mt-1 text-sm text-muted-foreground">{t(`example.features.${f}.text`)}</p>
      </Card>
    {/each}
  </div>
</section>

<!-- products from the module's table -->
<section id="products" class="bg-muted/40">
  <div class="mx-auto max-w-6xl px-4 py-16">
    <div class="flex items-end justify-between gap-4">
      <h2 class="text-2xl font-semibold">{t('example.products.title')}</h2>
      <span class="text-sm text-muted-foreground">{data.products.length} {t('example.widget.products')}</span>
    </div>
    {#if data.products.length}
      <ul class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="products">
        {#each data.products as p (p.id)}
          <li>
            <a href={`/product/${p.slug}`} class="block h-full no-underline hover:no-underline">
              <Card class="h-full transition-colors hover:bg-accent/40">
                <div class="mb-3 aspect-[4/3] w-full rounded-lg bg-primary/10" aria-hidden="true"></div>
                <h3 class="font-semibold text-foreground">{p.name}</h3>
                {#if p.summary}<p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.summary}</p>{/if}
                <p class="mt-3 text-sm"><span class="text-muted-foreground">{t('example.products.from')}</span> <strong class="text-foreground">{money(p.price, p.currency)}</strong></p>
              </Card>
            </a>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="mt-6 rounded-lg border bg-card p-6 text-center text-muted-foreground">{t('example.products.empty')}</p>
    {/if}
  </div>
</section>

<!-- testimonials -->
{#if data.testimonials.length}
  <section class="mx-auto max-w-6xl px-4 py-16">
    <h2 class="text-2xl font-semibold">{t('example.testimonials.title')}</h2>
    <div class="mt-6 grid gap-4 md:grid-cols-3">
      {#each data.testimonials as x (x.id)}
        <blockquote class="rounded-lg border bg-card p-5">
          <p class="text-foreground">“{x.quote}”</p>
          <footer class="mt-4 text-sm text-muted-foreground"><strong class="text-foreground">{x.author}</strong>{#if x.role} · {x.role}{/if}</footer>
        </blockquote>
      {/each}
    </div>
  </section>
{/if}

<!-- pricing -->
{#if data.showPricing}
  <section class="bg-muted/40">
    <div class="mx-auto max-w-6xl px-4 py-16">
      <h2 class="text-2xl font-semibold">{t('example.pricing.title')}</h2>
      <div class="mt-6 grid gap-4 md:grid-cols-3">
        {#each plans as plan (plan.k)}
          <Card class={plan.hi ? 'border-primary ring-2 ring-ring/30' : ''}>
            <h3 class="font-semibold">{t(`example.pricing.${plan.k}`)}</h3>
            <p class="mt-2 text-3xl font-semibold">{plan.price === null ? t('example.pricing.contact') : money(plan.price, 'IDR')}{#if plan.price !== null}<span class="text-base font-normal text-muted-foreground">{t('example.pricing.per_month')}</span>{/if}</p>
            <p class="mt-2 text-sm text-muted-foreground">{t(`example.pricing.${plan.k}.text`)}</p>
            <Button href="#contact" class="mt-4 w-full" variant={plan.hi ? 'default' : 'outline'}>{t('example.hero.cta2')}</Button>
          </Card>
        {/each}
      </div>
    </div>
  </section>
{/if}

<!-- contact (no JavaScript needed) -->
<section id="contact" class="mx-auto max-w-6xl px-4 py-16">
  <div class="grid gap-8 md:grid-cols-2">
    <div>
      <h2 class="text-2xl font-semibold">{t('example.contact.title')}</h2>
      <p class="mt-2 text-muted-foreground">{t('example.contact.lead')}</p>
    </div>
    <Card>
      {#if form?.sent || data.sent}
        <p class="notice" role="status" data-testid="contact-sent">{t('example.contact.sent')}</p>
      {:else}
        {#if form?.error}<p class="error mb-4" role="alert">{form.error === 'rate_limited' ? t('example.contact.rate_limited') : t('example.contact.error')}</p>{/if}
        <form method="POST" action="/example?/contact#contact" class="grid gap-3">
          <Csrf token={data.csrf} />
          <!-- honeypot: hidden from people, irresistible to bots -->
          <div class="hidden" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off" /></label></div>
          <label class="grid gap-1 text-sm">{t('example.contact.name')}<input name="name" required minlength="2" maxlength="191" value={form?.values?.name ?? ''} class="h-9 rounded-md border border-input bg-background px-3" /></label>
          <label class="grid gap-1 text-sm">{t('example.contact.email')}<input name="email" type="email" required maxlength="191" value={form?.values?.email ?? ''} class="h-9 rounded-md border border-input bg-background px-3" /></label>
          <label class="grid gap-1 text-sm">{t('example.contact.message')}<textarea name="message" required minlength="10" maxlength="5000" rows="4" class="rounded-md border border-input bg-background px-3 py-2">{form?.values?.message ?? ''}</textarea></label>
          <div><Button type="submit"><Icon name="send" size={16} />{t('example.contact.send')}</Button></div>
        </form>
      {/if}
    </Card>
  </div>
</section>

<p class="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted-foreground">{t('example.footer.text')}</p>
