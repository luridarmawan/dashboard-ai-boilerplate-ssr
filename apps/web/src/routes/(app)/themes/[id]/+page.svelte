<script lang="ts">
import { Badge, Card, ConfirmDelete } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import type { LayoutData } from '../../$types';
import type { EditorValues } from '../_editor.ts';
import ThemeEditor from '../ThemeEditor.svelte';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const locale = useLocale() === 'en' ? 'en' : 'id';
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

<svelte:head><title>{data.theme.name[locale]}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3">
    <h1>{data.theme.name[locale]}</h1>
    <code class="text-sm">{data.theme.code}</code>
    {#if data.theme.scope === 'global'}<Badge variant="outline">{t('themes.global')}</Badge>{/if}
    <a href={`/theme?back=/themes/${data.theme.id}`} class="text-sm">{t('themes.edit.try_picker')} ↗</a>
  </div>
  <ThemeEditor {values} vocab={data.vocab} csrf={data.csrf} action="?/save" isNew={false} errors={details.errors ?? {}} contrast={details.contrast ?? []} {previews} notice={submitted?.saved || data.saved ? t('themes.edit.saved') : null} error={form?.error ?? null} />
  <Card>
    <ConfirmDelete csrf={data.csrf} href={`/themes/${data.theme.id}?confirm=delete#confirm-delete`} cancelHref={`/themes/${data.theme.id}`} confirming={data.confirmDelete || form?.code === 'confirm_failed'} error={form?.code === 'confirm_failed' ? form.error : null} label={t('themes.edit.delete')} description={t('themes.edit.delete_confirm_lead', { name: data.theme.name[locale] })} />
    <p class="mt-2 text-xs text-muted-foreground">{t('themes.edit.delete_note')}</p>
  </Card>
</div>
