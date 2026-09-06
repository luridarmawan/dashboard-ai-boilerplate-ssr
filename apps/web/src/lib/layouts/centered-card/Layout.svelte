<script lang="ts">
import type { AuthRegions } from '$lib/layouts/types';

/** `centered-card` — one card in the middle of the screen. Auth pages. */
let { brand, content, footer }: AuthRegions = $props();
</script>

<div class="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
  <div class="mb-6">{@render brand()}</div>
  <main id="content" class="w-full max-w-sm rounded-lg border bg-card p-6 text-card-foreground shadow-xs">{@render content()}</main>
  <footer class="mt-6 text-xs text-muted-foreground">{@render footer()}</footer>
</div>
