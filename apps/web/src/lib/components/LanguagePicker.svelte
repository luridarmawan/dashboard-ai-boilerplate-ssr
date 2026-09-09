<script lang="ts">
import { LOCALES } from '@core/i18n';
import { dropdown } from '$lib/actions/dropdown';
import { useT } from '$lib/i18n';
import Csrf from './Csrf.svelte';
import Flag from './Flag.svelte';
import Icon from './Icon.svelte';

/**
 * Language dropdown (K-7) that works without JavaScript: a native <details> holds a form whose
 * buttons post `lang` to /lang — the same action the language page uses — then redirect back.
 * `compact` shows the flag only (header); otherwise flag + name.
 */
interface Props {
  current: string;
  csrf: string;
  back: string;
  compact?: boolean;
  class?: string;
  variant?: 'dropdown' | 'submenu';
}
let {
  current,
  csrf,
  back,
  compact = false,
  class: className = '',
  variant = 'dropdown',
}: Props = $props();
const t = useT();
const name = (l: string) => (l === 'id' ? t('lang.id') : l === 'en' ? t('lang.en') : l);
</script>

{#if variant === 'submenu'}
  <details class={`group/lang ${className}`} data-testid="language-picker">
    <summary class="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent">
      <Icon name="language" size={16} class="text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate">
        {t('nav.language')}
        <span class="block truncate text-xs text-muted-foreground">{name(current)}</span>
      </span>
      <Icon name="chevron-down" size={14} class="transition-transform group-open/lang:rotate-180" />
    </summary>
    <form method="POST" action="/lang" class="ms-6 mt-0.5 grid gap-0.5 border-s ps-2">
      <Csrf token={csrf} />
      <input type="hidden" name="back" value={back} />
      {#each LOCALES as l (l)}
        <button
          type="submit"
          name="lang"
          value={l}
          aria-current={l === current ? 'true' : undefined}
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-foreground hover:bg-accent aria-[current=true]:bg-accent aria-[current=true]:font-medium"
        >
          <Flag locale={l} />
          <span class="min-w-0 flex-1 truncate">{name(l)}</span>
          {#if l === current}<Icon name="check" size={14} class="ms-auto" />{/if}
        </button>
      {/each}
    </form>
  </details>
{:else}
  <details class={`group relative ${className}`} data-testid="language-picker" use:dropdown>
    <summary class="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-sm hover:bg-accent" aria-label={`${t('nav.language')}: ${name(current)}`} title={name(current)}>
      <Flag locale={current} />
      {#if !compact}<span>{name(current)}</span>{/if}
      <Icon name="chevron-down" size={14} class="transition-transform group-open:rotate-180" />
    </summary>
    <form method="POST" action="/lang" class="absolute end-0 z-40 mt-1 min-w-48 rounded-md border bg-popover p-1 shadow-lg">
      <Csrf token={csrf} />
      <input type="hidden" name="back" value={back} />
      <ul class="grid gap-0.5">
        {#each LOCALES as l (l)}
          <li>
            <button type="submit" name="lang" value={l} aria-current={l === current ? 'true' : undefined} class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-foreground hover:bg-accent aria-[current=true]:bg-accent aria-[current=true]:font-medium">
              <Flag locale={l} /><span>{name(l)}</span>
              {#if l === current}<Icon name="check" size={14} class="ms-auto" />{/if}
            </button>
          </li>
        {/each}
      </ul>
    </form>
  </details>
{/if}
