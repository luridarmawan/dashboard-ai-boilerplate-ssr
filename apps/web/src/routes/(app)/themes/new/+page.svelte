<script lang="ts">
import type { EditorValues } from '../_editor.ts';
import ThemeEditor from '../ThemeEditor.svelte';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
type Details = {
  errors?: Record<string, string>;
  contrast?: { mode: string; fg: string; bg: string; message: string }[];
};
const details = $derived((form?.details ?? {}) as Details);
const values = $derived(
  ((form?.values as { values?: EditorValues } | undefined)?.values ?? data.values) as EditorValues,
);
const previews = $derived(
  (form?.values as { previews?: { light: string; dark: string } } | undefined)?.previews ??
    data.previews,
);
const scopeQ = $derived(data.scope === 'global' ? '&scope=global' : '');
</script>

<svelte:head><title>Buat tema</title></svelte:head>

<div class="page">
  <div>
    <h1>Buat tema {#if data.scope === 'global'}<span class="text-sm font-normal text-muted-foreground">(global — berlaku di semua tenant)</span>{/if}</h1>
    <p class="mt-1 text-sm text-muted-foreground">Pilih titik awal; seluruh token-nya disalin ke formulir di bawah. Ganti titik awal kapan saja sebelum menyimpan.</p>
  </div>
  <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Titik awal">
    {#each data.baseCards as b (b.id)}
      <li>
        <a href={`/themes/new?base=${b.id}${scopeQ}`} class={`grid gap-2 rounded-lg border bg-card p-2 text-card-foreground no-underline transition-colors hover:border-primary hover:no-underline ${b.id === data.values.base ? 'border-primary ring-2 ring-ring/40' : ''}`} aria-current={b.id === data.values.base ? 'true' : undefined}>
          <div class="overflow-hidden rounded-md border [&_svg]:h-auto [&_svg]:w-full">{@html b.preview}</div>
          <div class="flex items-center justify-between gap-2 px-1">
            <span class="truncate text-sm font-medium">{b.name}</span>
            <code class="text-[10px]">{b.id}</code>
          </div>
        </a>
      </li>
    {/each}
  </ul>
  <ThemeEditor {values} vocab={data.vocab} csrf={data.csrf} action="" isNew={true} errors={details.errors ?? {}} contrast={details.contrast ?? []} {previews} error={form?.error ?? null} />
</div>
