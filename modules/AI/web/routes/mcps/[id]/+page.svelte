<script lang="ts">
import { page } from '$app/state';
import Csrf from '$lib/components/Csrf.svelte';
import { FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, ConfirmDelete, Table } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import { headerLines, mcpFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const locale = useLocale();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const m = $derived(data.mcp);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID') : '—';

/**
 * Testing over fetch: the connection is retried and the tool table refilled without a page load.
 * Progressive enhancement only (L-20 over L-22) — the form below still posts to `?/test`, and with
 * JavaScript off the action renders through `form.tested`; `tested` simply prefers whatever the
 * fetch produced. Both paths call the same `POST /v1/m/ai/mcps/:id/test`, which is what actually
 * replaces the stored tool list, so what the table shows after a test is what the assistant sees.
 */
type Tool = {
  id: string;
  name: string;
  wire: string;
  wireName: string;
  description: string | null;
  enabled: boolean;
};
type Tested = { ok: boolean; error: string | null; ms: number; tools: Tool[]; at?: string };
let testing = $state(false);
let live = $state<Tested | null>(null);
const tested = $derived(live ?? (form?.tested as Tested | undefined) ?? null);
/**
 * A successful test is the freshest truth about what this server offers. A FAILED one leaves the
 * previously discovered tools standing — exactly as the API does, which only rewrites the rows
 * when the connection worked; erasing the table on a timeout would claim a server has no tools
 * when all we know is that we could not reach it just now.
 */
const tools = $derived<Tool[]>(tested?.ok ? tested.tools : m.tools);
const status = $derived(tested ? (tested.ok ? 'ok' : 'error') : m.lastStatus);
/** Connected already? Then the button re-tests and reloads the list rather than introducing it. */
const connected = $derived(status === 'ok');
const syncedAt = $derived(tested?.at ?? (m.lastSyncedAt as string | null));
const failure = $derived(
  tested && !tested.ok ? tested.error : !tested && m.lastStatus === 'error' ? m.lastError : null,
);

/**
 * Searching the tool list. A server can offer dozens of tools whose names differ by one word, and
 * the answer to "does this server still expose `create_issue`?" should not be a Ctrl-F.
 *
 * The rows are ALL already on the page — the API returns the whole list, there is no paging — so
 * the filter is a pure client-side narrowing, not another request. The base still works without
 * JavaScript: the box is a real `method="GET"` field, submitting reloads the page with `?q=`, and
 * the initial value is read back from the URL, so the server-rendered HTML is already filtered.
 */
let query = $state(page.url.searchParams.get('q') ?? '');
const needle = $derived(query.trim().toLowerCase());
const shown = $derived(
  needle
    ? tools.filter((tl) =>
        `${tl.name} ${tl.wireName} ${tl.description ?? ''}`.toLowerCase().includes(needle),
      )
    : tools,
);
/** With JavaScript the box has already filtered as it was typed; Enter must not reload. */
const searchSubmit = (event: SubmitEvent) => event.preventDefault();

async function runTest(event: SubmitEvent) {
  event.preventDefault();
  const el = event.currentTarget as HTMLFormElement;
  testing = true;
  try {
    const res = await fetch(`/m/ai/mcps/${m.id}/test`, { method: 'POST', body: new FormData(el) });
    const body = (await res.json()) as Tested & { error?: string };
    live = res.ok
      ? { ...body, at: new Date().toISOString() }
      : {
          ok: false,
          error: body.error ?? `HTTP ${res.status}`,
          ms: 0,
          tools: [],
          at: new Date().toISOString(),
        };
  } catch (err) {
    live = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: 0,
      tools: [],
      at: new Date().toISOString(),
    };
  } finally {
    testing = false;
  }
}
</script>

<svelte:head><title>{m.name}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3">
    <h1>{m.name}</h1>
    <code class="text-sm">{m.code}</code>
    {#if status === 'ok'}<Badge variant="success">ok</Badge>{:else if status === 'error'}<Badge variant="destructive">error</Badge>{/if}
  </div>
  <Card>
    <FormBuilder
      fields={mcpFields(t)}
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
    <div class="mb-3 flex flex-wrap items-center gap-2">
      {#if can('ai.mcp.manage')}
        <!-- Base: a POST to `?/test`. Enhanced: the same request over fetch, same endpoint. -->
        <form method="POST" action="?/test" onsubmit={runTest}>
          <Csrf token={data.csrf} />
          <Button type="submit" variant="outline" size="sm" disabled={testing} aria-busy={testing} data-testid="mcp-test">
            <Icon name="refresh" size={16} class={testing ? 'animate-spin' : ''} />
            {testing ? t('common.running') : connected ? t('ai.mcps.retest') : t('ai.mcps.test')}
          </Button>
        </form>
      {/if}
      <!--
        Search sits next to the button because it answers about the very list that button reloads.
        `method="GET"` with no action posts back to this same page, so without JavaScript Enter
        reloads it as `?q=…` and the server renders the narrowed table; with JavaScript `oninput`
        has already narrowed it and the submit is swallowed.
      -->
      <form method="GET" onsubmit={searchSubmit} role="search" class="flex items-center gap-2">
        <label class="sr-only" for="mcp-tool-q">{t('ai.mcps.search_tools')}</label>
        <input
          id="mcp-tool-q"
          name="q"
          type="search"
          bind:value={query}
          placeholder={t('ai.mcps.search_tools')}
          autocomplete="off"
          class="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
          data-testid="mcp-tool-search"
        />
        <!-- Only the no-JavaScript path needs it; with JavaScript the list is already narrowed. -->
        <noscript>
          <Button type="submit" variant="outline" size="sm"><Icon name="search" size={16} />{t('common.apply')}</Button>
        </noscript>
      </form>
      <p class="text-sm text-muted-foreground" data-testid="mcp-tools-count">
        {#if needle}{t('ai.mcps.tools_filtered', { shown: shown.length, total: tools.length })}
        {:else}{t('ai.mcps.tools_available', { count: tools.length })}{/if}
        {#if syncedAt}<span class="ms-1">· {fmt(syncedAt)}</span>{/if}
        {#if tested?.ok}<span class="ms-1">· {tested.ms} ms</span>{/if}
      </p>
    </div>
    {#if tested?.ok}
      <p class="notice" data-testid="mcp-test-ok">{t('ai.mcps.tested_ok')} {tested.tools.length} · {tested.ms} ms</p>
    {:else if failure}
      <p class="error" role="alert" data-testid="mcp-test-fail">{t('ai.mcps.tested_fail')}: {failure}</p>
    {/if}
    <Table caption={t('ai.mcps.tools')}>
      <thead><tr><th>{t('ai.mcps.tool')}</th><th>{t('ai.mcps.wire_hint')}</th><th>{t('ai.mcps.description')}</th></tr></thead>
      <tbody>
        {#each shown as tl (tl.id)}
          <tr data-testid="mcp-tool-row">
            <td class="font-medium">{tl.name}{#if !tl.enabled} <Badge variant="secondary">{t('ai.mcps.disabled')}</Badge>{/if}</td>
            <td><code>{tl.wireName}</code></td>
            <td class="text-muted-foreground">{tl.description ?? '—'}</td>
          </tr>
        {:else}
          <tr><td colspan="3" class="py-6 text-center text-muted-foreground">{needle ? t('ai.mcps.tools_no_match') : status ? t('ai.mcps.tools_empty') : t('ai.mcps.never')}</td></tr>
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
