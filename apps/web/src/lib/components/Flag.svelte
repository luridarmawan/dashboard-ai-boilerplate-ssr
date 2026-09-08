<script lang="ts">
/**
 * Flag of a UI locale, inline SVG so it renders the same on every OS (emoji flags do not exist
 * on Windows). Decorative: the locale NAME next to it carries the meaning. Unknown locale → globe.
 */
import Icon from './Icon.svelte';

let {
  locale,
  size = 18,
  class: className = '',
}: { locale: string; size?: number; class?: string } = $props();
const w = $derived(size);
const h = $derived(Math.round((size * 3) / 4));
</script>

{#if locale === 'id'}
  <svg width={w} height={h} viewBox="0 0 4 3" class={`shrink-0 rounded-[2px] ring-1 ring-border ${className}`} aria-hidden="true" focusable="false"><title>Indonesia</title><rect width="4" height="1.5" fill="#ce1126" /><rect y="1.5" width="4" height="1.5" fill="#fff" /></svg>
{:else if locale === 'en'}
  <svg width={w} height={h} viewBox="0 0 60 30" class={`shrink-0 rounded-[2px] ring-1 ring-border ${className}`} aria-hidden="true" focusable="false"><title>United Kingdom</title><clipPath id="uk-half"><path d="M30 15h30v15zv15H0zH0V0zV0h30z" /></clipPath><rect width="60" height="30" fill="#012169" /><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6" /><path d="M0 0l60 30m0-30L0 30" clip-path="url(#uk-half)" stroke="#c8102e" stroke-width="4" /><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10" /><path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6" /></svg>
{:else}
  <Icon name="language" size={w} class={className} />
{/if}
