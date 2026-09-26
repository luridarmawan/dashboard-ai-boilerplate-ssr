<script lang="ts">
import ProductDetail from '../../_lib/ProductDetail.svelte';

/** Product page (R-3/R-4): the shared detail component, canonical at `/product/<slug>`. */
let { data } = $props();
</script>

<ProductDetail product={data.product} brand={data.brand} url={`${data.origin}/product/${data.product.slug}`} />
