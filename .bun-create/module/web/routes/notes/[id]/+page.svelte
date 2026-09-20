<script lang="ts">
import { Card, ConfirmDelete, FormBuilder } from '@core/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import { noteFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const r = $derived(data.row);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{r.title ?? r.id}</title></svelte:head>

<div class="page">
  <h1>{r.title ?? r.id}</h1>
  <Card>
    <FormBuilder fields={noteFields(t)} values={r as unknown as Record<string, unknown>} errors={fieldErrors} csrf={data.csrf} action="?/save" columns={2} readonly={!can('hello.note.edit')} cancelHref="/m/hello/notes" cancelLabel={t('common.back')} notice={form?.saved || data.saved ? t('hello.notes.saved') : null} error={form?.error && form.code !== 'confirm_failed' && Object.keys(fieldErrors).length === 0 ? form.error : null} />
  </Card>
  {#if can('hello.note.manage')}
    <Card><ConfirmDelete csrf={data.csrf} href={`/m/hello/notes/${r.id}?confirm=delete#confirm-delete`} cancelHref={`/m/hello/notes/${r.id}`} confirming={data.confirmDelete || form?.code === 'confirm_failed'} error={form?.code === 'confirm_failed' ? form.error : null} /></Card>
  {/if}
</div>
