<script lang="ts">
import type { EditorValues } from '../_editor.ts';
import ThemeEditor from '../ThemeEditor.svelte';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
type Details = {
  errors?: Record<string, string>;
  contrast?: {
    mode: string;
    fg: string;
    bg: string;
    ratio: number | null;
    minimum: number;
    message: string;
  }[];
};
const details = $derived((form?.details ?? {}) as Details);
const values = $derived(
  ((form?.values as { values?: EditorValues } | undefined)?.values ?? data.values) as EditorValues,
);
const previews = $derived(
  (form?.values as { previews?: { light: string; dark: string } } | undefined)?.previews ??
    data.previews,
);
</script>

<svelte:head><title>Buat tema</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>Buat tema {#if data.scope === 'global'}<span class="text-sm text-muted-foreground">(global)</span>{/if}</h1>
    <p class="text-sm text-muted-foreground">Mulai dari: {#each data.vocab.bases as b, i (b.id)}{#if i} · {/if}<a href={`/themes/new?base=${b.id}${data.scope === 'global' ? '&scope=global' : ''}`} class={b.id === data.values.base ? 'font-medium' : ''}>{b.name.id}</a>{/each}</p>
  </div>
  <ThemeEditor {values} vocab={data.vocab} csrf={data.csrf} action="" isNew={true} errors={details.errors ?? {}} contrast={details.contrast ?? []} {previews} error={form?.error ?? null} />
</div>
