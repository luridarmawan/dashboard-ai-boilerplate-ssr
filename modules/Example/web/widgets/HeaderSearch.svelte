<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';

/**
 * The public header's search box (widget slot `public-search`). Core draws no search box of its
 * own: this one exists while the Example module is enabled, and disabling the module removes it
 * from every public page. A plain GET form to the catalogue — category, words, button — so it
 * works without JavaScript and the results page is linkable. A real shop points it at its own
 * search page.
 *
 * The ids (`top-frm-search`, `search-category`, `search-input`, `search-submit`) are styling
 * hooks a theme or a derived app may target; there is only ever one header search per page.
 */
let { context, data }: { context?: { path: string }; data?: unknown } = $props();
const t = useT();
/** Categories from `GET /v1/m/example/categories` (the widget's `data`); none = no select. */
const categories = $derived(
  Array.isArray(data)
    ? (data as { slug: string; name: string }[]).map((c) => ({ slug: c.slug, name: c.name }))
    : [],
);
/** Keep the query and category in the box on the results page, so they can be refined. */
const current = $derived.by(() => {
  const url = new URL(context?.path ?? '/', 'http://x');
  const onCatalog = url.pathname === '/catalog';
  return {
    q: onCatalog ? (url.searchParams.get('q') ?? '') : '',
    category: onCatalog ? (url.searchParams.get('category') ?? '') : '',
  };
});
</script>

<form
  id="top-frm-search"
  method="GET"
  action="/catalog"
  role="search"
  class="flex h-9 w-full items-stretch overflow-hidden rounded-full border border-input bg-background focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
  data-testid="example-header-search"
>
  {#if categories.length}
    <select
      id="search-category"
      name="category"
      aria-label={t('example.header.search_category')}
      class="max-w-28 shrink-0 cursor-pointer sm:max-w-36 border-e border-input bg-muted/50 ps-3 pe-2 text-xs text-foreground outline-none"
    >
      <option value="">{t('example.catalog.category_all')}</option>
      {#each categories as c (c.slug)}<option value={c.slug} selected={current.category === c.slug}>{c.name}</option>{/each}
    </select>
  {/if}
  <input
    id="search-input"
    type="search"
    name="q"
    value={current.q}
    maxlength={191}
    placeholder={t('example.header.search_placeholder')}
    title={t('example.header.search_placeholder')}
    aria-label={t('example.header.search_label')}
    class="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
  />
  <button
    id="search-submit"
    type="submit"
    class="flex shrink-0 items-center gap-1.5 bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
  >
    <Icon name="search" size={16} />
    <span class="hidden sm:inline">{t('example.header.search_go')}</span>
    <span class="sr-only sm:hidden">{t('example.header.search_go')}</span>
  </button>
</form>
