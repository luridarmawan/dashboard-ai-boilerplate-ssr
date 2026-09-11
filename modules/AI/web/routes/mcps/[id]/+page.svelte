<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, ConfirmDelete, Table } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import { headerLines, mcpFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const m = $derived(data.mcp);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
// After a test the freshest list is in the action result; otherwise what the page loaded.
const tools = $derived(form?.tested?.tools ?? m.tools);
</script>

<svelte:head><title>{m.name}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3">
    <h1>{m.name}</h1>
    <code class="text-sm">{m.code}</code>
    {#if m.lastStatus === 'ok'}<Badge variant="success">ok</Badge>{:else if m.lastStatus === 'error'}<Badge variant="destructive">error</Badge>{/if}
  </div>
  <Card>
    <FormBuilder
      fields={mcpFields}
      values={{ name: m.name, code: m.code, transport: m.transport, url: m.url, headers: headerLines(m.headers), enabled: m.enabled }}
      errors={fieldErrors}
      csrf={data.csrf}
      action="?/save"
      columns={2}
      readonly={!can('ai.mcp.manage')}
      cancelHref="/m/ai/mcps"
      cancelLabel={t('common.back')}
      notice={form?.saved || data.saved ? t('ai.mcps.saved') : null}
      error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null}
    />
  </Card>
  <Card title={t('ai.mcps.tools')}>
    {#if can('ai.mcp.manage')}
      <form method="POST" action="?/test" class="mb-3"><Csrf token={data.csrf} /><Button type="submit" variant="outline" size="sm"><Icon name="refresh" size={16} />{t('ai.mcps.test')}</Button></form>
    {/if}
    {#if form?.tested}
      {#if form.tested.ok}
        <p class="notice" data-testid="mcp-test-ok">{t('ai.mcps.tested_ok')} {form.tested.tools.length} · {form.tested.ms} ms</p>
      {:else}
        <p class="error" role="alert" data-testid="mcp-test-fail">{t('ai.mcps.tested_fail')}: {form.tested.error}</p>
      {/if}
    {:else if m.lastStatus === 'error' && m.lastError}
      <p class="error" role="alert">{t('ai.mcps.tested_fail')}: {m.lastError}</p>
    {/if}
    <Table caption={t('ai.mcps.tools')}>
      <thead><tr><th>Tool</th><th>{t('ai.mcps.wire_hint')}</th><th>Deskripsi</th></tr></thead>
      <tbody>
        {#each tools as tl (tl.id)}
          <tr><td class="font-medium">{tl.name}</td><td><code>{tl.wireName}</code></td><td class="text-muted-foreground">{tl.description ?? '—'}</td></tr>
        {:else}
          <tr><td colspan="3" class="py-6 text-center text-muted-foreground">{t('ai.mcps.never')}</td></tr>
        {/each}
      </tbody>
    </Table>
  </Card>
  {#if can('ai.mcp.manage')}
    <Card>
      <ConfirmDelete csrf={data.csrf} href={`/m/ai/mcps/${m.id}?confirm=delete#confirm-delete`} cancelHref={`/m/ai/mcps/${m.id}`} confirming={data.confirmDelete || form?.code === 'confirm_failed'} error={form?.code === 'confirm_failed' ? form.error : null} description={t('ai.mcps.delete_confirm_lead', { name: m.name })} />
    </Card>
  {/if}
</div>
