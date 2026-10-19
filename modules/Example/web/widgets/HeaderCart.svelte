<script lang="ts">
import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';
import { CART_COOKIE, parseCart } from '../../cart.ts';

/**
 * The cart icon of the public header (widget slot `public-actions`) — see `modules/Example/cart.ts`.
 * The link is server-rendered; the count is read from the cart cookie in the browser, because the
 * web forwards only core cookies to the API, so no server-side `data` call could see this one.
 * Without JavaScript the icon still leads to the cart, just without the number.
 */
const t = useT();
// Header widgets receive `context`; this one needs nothing from it.
let { context: _context }: { context?: unknown } = $props();
let count = $state(0);

function read() {
  const raw = document.cookie
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${CART_COOKIE}=`));
  count = parseCart(raw ? decodeURIComponent(raw.slice(CART_COOKIE.length + 1)) : '').reduce(
    (n, l) => n + l.qty,
    0,
  );
}

onMount(read);
// Adding from the product page or changing the cart page navigates client-side: re-read then.
afterNavigate(read);
</script>

<a
  href="/cart"
  class="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-accent"
  aria-label={count ? t('example.header.cart_count', { count: String(count) }) : t('example.header.cart')}
  title={t('example.header.cart')}
  data-testid="example-header-cart"
>
  <Icon name="cart" />
  {#if count}
    <span class="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground" data-testid="example-header-cart-count">{count > 99 ? '99+' : count}</span>
  {/if}
</a>
