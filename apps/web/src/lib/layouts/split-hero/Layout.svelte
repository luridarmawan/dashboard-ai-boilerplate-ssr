<script lang="ts">
import { useT } from '$lib/i18n';
import type { AuthRegions } from '$lib/layouts/types';

/** `split-hero` — form on the left, brand panel on the right; stacks under lg. Auth pages. */
let { brand, content, footer, background = null }: AuthRegions = $props();
/**
 * Panel copy is deploy-time branding: `landing.lead` ← APP_LANDING_LEAD, `shell.footer` ← APP_FOOTER_TITLE.
 * `background` is the same kind of thing — LOGIN_PAGE_BACKGROUND, already validated by the shell.
 */
const t = useT();
</script>

<div class="grid min-h-dvh lg:grid-cols-2">
  <div class="left flex flex-col px-6 py-8 lg:px-16">
    <div>{@render brand()}</div>
    <main id="content" class="my-auto w-full max-w-sm py-10">{@render content()}</main>
    <footer class="text-xs text-muted-foreground">{@render footer()}</footer>
  </div>
  <div class="right relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-end lg:p-16" aria-hidden="true">
    {#if background}
      <!--
        Decorative backdrop, so it stays TRANSPARENT: the brand colour underneath is what the panel
        IS, and `text-primary-foreground` is only guaranteed to be readable against that colour.
        The picture tints it rather than replacing it, so the copy survives any photo.

        A CSS background rather than an <img>, for two reasons a decorative picture cares about:
        a fetch that fails paints NOTHING (an <img> leaves the browser's broken-image glyph in the
        corner), and the browser never requests it while the panel is `hidden` — so a phone, which
        never renders this column, never spends the bytes.
      -->
      <div class="pointer-events-none absolute inset-0 bg-cover bg-center opacity-25 mix-blend-luminosity" style:background-image={`url("${background}")`}></div>
    {/if}
    <p class="relative text-3xl font-semibold leading-tight">{t('landing.title')}</p>
    <p class="relative mt-3 max-w-md text-primary-foreground/80">{t('landing.lead')}</p>
  </div>
</div>
