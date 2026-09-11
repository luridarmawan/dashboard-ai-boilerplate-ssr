<script lang="ts">
import { goto } from '$app/navigation';
import { navigating } from '$app/state';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';

/**
 * The catalogue landing (R-9) — the module's second public arrangement. Same tables, same tokens,
 * same rules as `/example` (no literal colours, no literal copy, everything server-rendered), but
 * a different SHAPE: a masthead, a filter bar, and a dense list. That is the whole point of the
 * variant: one module may own more than one public page, and either can answer `/`.
 *
 * Two layers (L-20 over L-22). BASE: the filter bar is a GET form and the sort controls are
 * links, so it works with JavaScript off and the API does the filtering. ENHANCED: the same
 * controls answer over fetch — typing searches after a pause, the rest navigate client-side.
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
const title = $derived(`${data.brand} — ${t('example.catalog.title')}`);
const description = $derived(data.tagline ?? t('example.catalog.lead'));
/** A catalogue is a list of things; say so in structured data (a storefront says Organization). */
const ld = $derived(
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    numberOfItems: data.products.length,
    itemListElement: data.products.map((p: { name: string; slug: string }, i: number) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.name,
      url: `${data.origin}/product/${p.slug}`,
    })),
  }),
);
const initial = (name: string) => name.trim().charAt(0).toUpperCase();

const f = $derived(data.filters);
/** Every control keeps the rest of the filter state; only what it patches changes. */
const href = (patch: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams();
  const base: Record<string, string | undefined> = {
    q: f.q || undefined,
    sort: f.sort === 'catalog' ? undefined : f.sort,
    order: f.sort === 'catalog' || f.order === 'desc' ? undefined : f.order,
    featured: f.featured ? '1' : undefined,
    ...patch,
  };
  for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/catalog?${s}` : '/catalog';
};
/** Clicking the active sort flips its direction; a new one starts ascending (A→Z, cheapest first). */
const sortHref = (key: 'name' | 'price') =>
  href({
    sort: key,
    order: f.sort === key && f.order === 'asc' ? 'desc' : 'asc',
  });
const sortIcon = (key: 'name' | 'price') =>
  f.sort !== key ? 'sort' : f.order === 'asc' ? 'chevron-up' : 'chevron-down';
const filtered = $derived(Boolean(f.q || f.featured || f.sort !== 'catalog'));

// ---- enhanced layer: the same controls, without the page reload ---------------------------
const loading = $derived(navigating.to !== null);
let filterForm = $state<HTMLFormElement | null>(null);
let debounce: ReturnType<typeof setTimeout> | undefined;

/** Read the form as FormData so the DOM stays the single source of truth for the filter. */
function applyFilters(replace = false) {
  if (!filterForm) return;
  const p = new URLSearchParams();
  for (const [k, v] of new FormData(filterForm)) {
    const s = String(v).trim();
    if (s) p.set(k, s);
  }
  const qs = p.toString();
  void goto(qs ? `/catalog?${qs}` : '/catalog', {
    keepFocus: true,
    noScroll: true,
    replaceState: replace,
  });
}
/** Typing searches on its own; the pause is what keeps it one request per word, not per key. */
function searchTyped() {
  clearTimeout(debounce);
  debounce = setTimeout(() => applyFilters(true), 300);
}
function submitFilters(event: SubmitEvent) {
  event.preventDefault();
  clearTimeout(debounce);
  applyFilters();
}
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={`${data.origin}/catalog`} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={`${data.origin}/catalog`} />
  <meta property="og:site_name" content={data.brand} />
  <meta name="twitter:card" content="summary" />
  {@html `<script type="application/ld+json">${ld}</script>`}
</svelte:head>

<!-- masthead: no hero, no mosaic — a catalogue says what it holds and gets out of the way -->
<section class="border-b bg-card">
  <div class="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-10">
    <div class="max-w-2xl">
      <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">{data.brand}</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('example.catalog.title')}</h1>
      <p class="mt-3 text-muted-foreground">{data.tagline ?? t('example.catalog.lead')}</p>
    </div>
    <a href="/example" class="inline-flex items-center gap-1 text-sm font-medium text-primary">{t('example.catalog.to_storefront')}<Icon name="arrow-right" size={14} class="rtl:rotate-180" /></a>
  </div>
</section>

<!-- filter bar: a plain GET form (base), applied as you type (enhanced) -->
<section class="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
  <form
    method="GET"
    action="/catalog"
    bind:this={filterForm}
    onsubmit={submitFilters}
    class="mx-auto flex max-w-6xl flex-wrap items-end gap-3 px-4 py-3"
    data-testid="catalog-filters"
  >
    <label class="grid flex-1 gap-1 text-xs font-medium text-muted-foreground sm:min-w-64">
      {t('example.catalog.search')}
      <input
        type="search"
        name="q"
        value={f.q}
        oninput={searchTyped}
        placeholder={t('example.catalog.search_hint')}
        maxlength="191"
        class="h-10 rounded-xl border border-input bg-background px-3 text-sm font-normal text-foreground"
      />
    </label>
    <label class="flex h-10 items-center gap-2 rounded-xl border border-input px-3 text-sm text-foreground">
      <input type="checkbox" name="featured" value="1" checked={f.featured} onchange={() => applyFilters()} />
      {t('example.catalog.featured_only')}
    </label>
    <!-- The sort is part of the same form so it survives a no-JS submit, and it is also two
         ordinary links below — a select alone would need JavaScript to apply. -->
    <input type="hidden" name="sort" value={f.sort === 'catalog' ? '' : f.sort} />
    <input type="hidden" name="order" value={f.sort === 'catalog' ? '' : f.order} />
    <Button type="submit" variant="outline" class="h-10 rounded-xl">{t('example.catalog.apply')}</Button>
    {#if filtered}
      <a href="/catalog" class="text-sm text-muted-foreground hover:text-foreground">{t('example.catalog.reset')}</a>
    {/if}
  </form>
</section>

<section class="mx-auto max-w-6xl px-4 py-8">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm text-muted-foreground" data-testid="catalog-count" aria-live="polite">
      {data.total}
      {t('example.widget.products')}{#if f.q} · “{f.q}”{/if}
    </p>
    <div class="flex items-center gap-1 text-sm">
      <span class="text-muted-foreground">{t('example.catalog.sort')}</span>
      <a href={href({ sort: undefined, order: undefined })} aria-current={f.sort === 'catalog' ? 'true' : undefined} class="rounded-full px-3 py-1 text-foreground no-underline hover:bg-accent hover:no-underline aria-[current=true]:bg-accent aria-[current=true]:font-medium">{t('example.catalog.sort_default')}</a>
      {#each [['name', t('example.catalog.sort_name')], ['price', t('example.catalog.sort_price')]] as [key, label] (key)}
        <a href={sortHref(key as 'name' | 'price')} aria-current={f.sort === key ? 'true' : undefined} class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-foreground no-underline hover:bg-accent hover:no-underline aria-[current=true]:bg-accent aria-[current=true]:font-medium">
          {label}<Icon name={sortIcon(key as 'name' | 'price')} size={14} />
        </a>
      {/each}
    </div>
  </div>

  {#if data.products.length}
    <!-- A catalogue row, not a card: image thumb, name, summary, price, one action. -->
    <ul class="mt-6 grid gap-3" data-testid="catalog-items" class:opacity-60={loading}>
      {#each data.products as p (p.id)}
        <li>
          <a href={`/product/${p.slug}`} class="group flex items-center gap-4 rounded-2xl border bg-card p-3 no-underline transition-colors hover:bg-accent/40 hover:no-underline sm:p-4">
            <span class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-gradient-to-br from-primary/20 via-accent to-secondary text-2xl font-semibold text-primary/60">
              {#if p.imageUrl}<img src={p.imageUrl} alt="" loading="lazy" class="h-full w-full object-cover" />{:else}{initial(p.name)}{/if}
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
    <p class="mt-6 rounded-2xl border bg-card p-8 text-center text-muted-foreground" data-testid="catalog-empty">
      {filtered ? t('example.catalog.no_match') : t('example.products.empty')}
    </p>
  {/if}
</section>

<!-- contact, reduced to one strip: the catalogue sells nothing by itself -->
<section id="contact" class="border-t bg-muted/40">
  <div class="mx-auto grid max-w-6xl gap-6 px-4 py-12 md:grid-cols-[1fr_1.2fr] md:items-center">
    <div>
      <h2 class="text-xl font-semibold tracking-tight">{t('example.contact.title')}</h2>
      <p class="mt-2 text-sm text-muted-foreground">{t('example.contact.lead')}</p>
    </div>
    {#if form?.sent || data.sent}
      <p class="notice" role="status" data-testid="contact-sent">{t('example.contact.sent')}</p>
    {:else}
      <form method="POST" action="/catalog?/contact#contact" class="grid gap-3 sm:grid-cols-2">
        <Csrf token={data.csrf} />
        <div class="hidden" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off" /></label></div>
        <label class="grid gap-1 text-sm font-medium">{t('example.contact.name')}<input name="name" required minlength="2" maxlength="191" value={form?.values?.name ?? ''} class="h-10 rounded-xl border border-input bg-background px-3 font-normal" /></label>
        <label class="grid gap-1 text-sm font-medium">{t('example.contact.email')}<input name="email" type="email" required maxlength="191" value={form?.values?.email ?? ''} class="h-10 rounded-xl border border-input bg-background px-3 font-normal" /></label>
        <label class="grid gap-1 text-sm font-medium sm:col-span-2">{t('example.contact.message')}<textarea name="message" required minlength="10" maxlength="5000" rows="3" class="rounded-xl border border-input bg-background px-3 py-2 font-normal">{form?.values?.message ?? ''}</textarea></label>
        {#if form?.error}<p class="error sm:col-span-2" role="alert">{form.error === 'rate_limited' ? t('example.contact.rate_limited') : t('example.contact.error')}</p>{/if}
        <div class="sm:col-span-2"><Button type="submit" class="rounded-full px-6"><Icon name="send" size={16} />{t('example.contact.send')}</Button></div>
      </form>
    {/if}
  </div>
</section>

<p class="mx-auto max-w-6xl px-4 py-8 text-xs text-muted-foreground">{t('example.footer.text')}</p>
