<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import type { LayoutData } from '../../$types';
import type { EditorValues } from '../_editor.ts';
import ThemeEditor from '../ThemeEditor.svelte';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
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
const submitted = $derived(
  form as {
    values?: EditorValues | { values?: EditorValues };
    previews?: { light: string; dark: string };
    saved?: boolean;
  } | null,
);
const values = $derived(
  ((submitted?.values as { values?: EditorValues } | undefined)?.values ??
    (submitted?.values as EditorValues | undefined) ??
    data.values) as EditorValues,
);
const previews = $derived(
  submitted?.previews ??
    (submitted?.values as { previews?: { light: string; dark: string } } | undefined)?.previews ??
    data.previews,
);
</script>

<svelte:head><title>{data.theme.name.id}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3">
    <h1>{data.theme.name.id}</h1>
    <code class="text-sm">{data.theme.code}</code>
    {#if data.theme.scope === 'global'}<Badge variant="outline">global</Badge>{/if}
    <a href={`/theme?back=/themes/${data.theme.id}`} class="text-sm">Coba di pemilih tema ↗</a>
  </div>
  <ThemeEditor {values} vocab={data.vocab} csrf={data.csrf} action="?/save" isNew={false} errors={details.errors ?? {}} contrast={details.contrast ?? []} {previews} notice={submitted?.saved || data.saved ? 'Tema tersimpan dan sudah berlaku.' : null} error={form?.error ?? null} />
  <Card>
    <form method="POST" action="?/delete"><Csrf token={data.csrf} /><Button type="submit" variant="destructive"><Icon name="trash" size={16} />Hapus tema</Button></form>
    <p class="mt-2 text-xs text-muted-foreground">Pengguna yang memakainya akan jatuh ke tema baku lewat rantai resolusi (L-12) — tanpa galat.</p>
  </Card>
</div>
