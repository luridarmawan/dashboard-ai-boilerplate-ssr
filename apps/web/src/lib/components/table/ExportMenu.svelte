<script lang="ts">
import { dropdown } from '$lib/actions/dropdown';
import Icon from '$lib/components/Icon.svelte';
import { buttonVariants } from '$lib/components/ui/button';
import { useT } from '$lib/i18n';

/**
 * "Export" menu for a list: one link per format to an endpoint that answers `?format=xlsx|csv`
 * (see `@core/export`). A native <details>, so it works without JavaScript; the links carry
 * `download` and skip the client router, because the answer is a file, not a page.
 */
type Format = 'xlsx' | 'csv';
interface Props {
  /** The export endpoint; may already hold a query (filters), `format` is appended. */
  href: string;
  formats?: readonly Format[];
  label?: string;
  class?: string;
}
let { href, formats = ['xlsx', 'csv'], label, class: className = '' }: Props = $props();
const t = useT();
const url = (f: Format) => `${href}${href.includes('?') ? '&' : '?'}format=${f}`;
const close = (e: MouseEvent) =>
  (
    (e.currentTarget as HTMLElement).closest('details') as HTMLDetailsElement | null
  )?.removeAttribute('open');
</script>

<details class={`group relative ${className}`} data-testid="export-menu" use:dropdown>
  <summary class={`${buttonVariants({ variant: 'outline', size: 'sm' })} cursor-pointer list-none`}>
    <Icon name="download" size={16} />{label ?? t('common.export')}
    <Icon name="chevron-down" size={14} class="transition-transform group-open:rotate-180" />
  </summary>
  <ul class="absolute end-0 z-40 mt-1 grid min-w-44 gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
    {#each formats as f (f)}
      <li>
        <a href={url(f)} download data-sveltekit-reload data-testid={`export-${f}`} onclick={close} class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent">
          {t(`common.export_${f}`)}
        </a>
      </li>
    {/each}
  </ul>
</details>
