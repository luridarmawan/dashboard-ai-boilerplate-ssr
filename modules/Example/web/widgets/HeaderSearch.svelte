<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';

/**
 * The public header's search box (widget slot `public-search`). Core draws no search box of its
 * own: this one exists while the Example module is enabled, and disabling the module removes it
 * from every public page. A plain GET form to the catalogue, so it works without JavaScript and
 * the results page is linkable. A real shop points it at its own search page.
 */
let { context }: { context?: { path: string } } = $props();
const t = useT();
/** Keep the query in the box on the results page, so it can be refined. */
const q = $derived.by(() => {
  const url = new URL(context?.path ?? '/', 'http://x');
  return url.pathname === '/catalog' ? (url.searchParams.get('q') ?? '') : '';
});
</script>

<form method="GET" action="/catalog" role="search" class="relative" data-testid="example-header-search">
  <Icon name="search" size={16} class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
  <input
    type="search"
    name="q"
    value={q}
    maxlength={191}
    placeholder={t('example.header.search_placeholder')}
    title={t('example.header.search_placeholder')}
    aria-label={t('example.header.search_label')}
    class="h-9 w-full rounded-full border border-input bg-background ps-9 pe-3 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
  />
</form>
