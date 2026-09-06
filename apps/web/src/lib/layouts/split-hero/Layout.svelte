<script lang="ts">
import type { AuthRegions } from '$lib/layouts/types';

/** `split-hero` — form on the left, brand panel on the right; stacks under lg. Auth pages. */
let { brand, content, footer }: AuthRegions = $props();
</script>

<div class="grid min-h-dvh lg:grid-cols-2">
  <div class="flex flex-col px-6 py-8 lg:px-16">
    <div>{@render brand()}</div>
    <main id="content" class="my-auto w-full max-w-sm py-10">{@render content()}</main>
    <footer class="text-xs text-muted-foreground">{@render footer()}</footer>
  </div>
  <div class="hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-end lg:p-16" aria-hidden="true">
    <p class="text-3xl font-semibold leading-tight">Satu dashboard,<br />modul apa pun.</p>
    <p class="mt-3 max-w-md text-primary-foreground/80">API-first, multi-tenant, tema yang mengubah warna, ikon, dan susunan halaman.</p>
  </div>
</div>
