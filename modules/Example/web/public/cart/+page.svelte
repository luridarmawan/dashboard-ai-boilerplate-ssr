<script lang="ts">
import { enhance } from '$app/forms';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import Img from '$lib/components/Img.svelte';
import { Button } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';

/** The demo cart: lines from the visitor's cookie, priced by the API. No checkout on purpose. */
let { data } = $props();
const t = useT();
const locale = useLocale();
const money = (n: number, cur: string) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'id-ID', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 0,
  }).format(n);
const added = $derived(
  data.cart.items.find((i: { slug: string }) => i.slug === data.added) ?? null,
);
</script>

<svelte:head>
  <title>{t('example.cart.title')}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<section class="mx-auto grid max-w-3xl gap-6 px-4 py-12" data-testid="example-cart">
  <div>
    <h1 class="text-3xl font-semibold tracking-tight">{t('example.cart.title')}</h1>
    <p class="mt-2 text-sm text-muted-foreground">{t('example.cart.demo_note')}</p>
  </div>
  {#if added}
    <p class="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm" role="status">{t('example.cart.added', { name: added.name })}</p>
  {/if}
  {#if data.cart.items.length}
    <ul class="divide-y rounded-xl border">
      {#each data.cart.items as item (item.slug)}
        <li class="flex flex-wrap items-center gap-4 p-4">
          <div class="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted">
            {#if item.imageUrl}<Img src={item.imageUrl} alt="" width={64} height={64} class="h-full w-full object-cover" />{/if}
          </div>
          <div class="min-w-0 flex-1">
            <a href={`/product/${item.slug}`} class="font-medium">{item.name}</a>
            <p class="text-sm text-muted-foreground">{money(item.price, item.currency)}</p>
          </div>
          <div class="flex items-center gap-1">
            <form method="POST" action="?/change" use:enhance>
              <Csrf token={data.csrf} /><input type="hidden" name="slug" value={item.slug} /><input type="hidden" name="by" value="-1" />
              <Button type="submit" variant="outline" size="icon" class="h-8 w-8" aria-label={t('example.cart.less')}><Icon name="minus" size={16} /></Button>
            </form>
            <span class="w-8 text-center tabular-nums" data-testid="cart-qty">{item.qty}</span>
            <form method="POST" action="?/change" use:enhance>
              <Csrf token={data.csrf} /><input type="hidden" name="slug" value={item.slug} /><input type="hidden" name="by" value="1" />
              <Button type="submit" variant="outline" size="icon" class="h-8 w-8" aria-label={t('example.cart.more')}><Icon name="plus" size={16} /></Button>
            </form>
          </div>
          <p class="w-28 text-end font-medium tabular-nums">{money(item.price * item.qty, item.currency)}</p>
          <form method="POST" action="?/remove" use:enhance>
            <Csrf token={data.csrf} /><input type="hidden" name="slug" value={item.slug} />
            <Button type="submit" variant="ghost" size="icon" class="h-8 w-8 text-destructive" aria-label={t('example.cart.remove')}><Icon name="trash" size={16} /></Button>
          </form>
        </li>
      {/each}
    </ul>
    <div class="flex flex-wrap items-center justify-between gap-4">
      <form method="POST" action="?/clear" use:enhance>
        <Csrf token={data.csrf} />
        <Button type="submit" variant="ghost" size="sm">{t('example.cart.clear')}</Button>
      </form>
      <p class="text-lg">{t('example.cart.total')} <strong class="tabular-nums" data-testid="cart-total">{money(data.cart.total, data.cart.currency)}</strong></p>
    </div>
    <div class="flex flex-wrap gap-3">
      <Button href="/example#contact" class="rounded-full px-6">{t('example.product.order')}<Icon name="arrow-right" class="rtl:rotate-180" size={18} /></Button>
      <Button href="/catalog" variant="outline" class="rounded-full px-6">{t('example.cart.continue')}</Button>
    </div>
  {:else}
    <div class="grid justify-items-start gap-4 rounded-xl border border-dashed p-8">
      <p class="text-muted-foreground">{t('example.cart.empty')}</p>
      <Button href="/catalog" class="rounded-full px-6">{t('example.cart.continue')}</Button>
    </div>
  {/if}
</section>
