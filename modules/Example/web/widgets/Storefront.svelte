<script lang="ts">
/** Widgets receive the dashboard `context` and render; data fetching belongs to the module's pages. */
let { context }: { context?: { locale: string } } = $props();
const en = $derived(context?.locale === 'en');
</script>

<div class="grid gap-2 text-sm" data-testid="widget-example">
  <a href="/m/example/products" class="font-medium">{en ? 'Manage products' : 'Kelola produk'} →</a>
  <a href="/m/example/inquiries">{en ? 'Inquiries' : 'Pesan masuk'} →</a>
  <a href="/example" class="text-muted-foreground">{en ? 'Open the public storefront' : 'Buka etalase publik'} ↗</a>
</div>
