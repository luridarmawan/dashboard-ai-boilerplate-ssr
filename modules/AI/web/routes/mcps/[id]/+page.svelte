<script lang="ts">
import { onMount } from 'svelte';
import { page } from '$app/state';
import Csrf from '$lib/components/Csrf.svelte';
import { FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, Checkbox, ConfirmDelete, Select, Table } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import { headerLines, mcpFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const locale = useLocale();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const manage = $derived(can('ai.mcp.manage'));
const m = $derived(data.mcp);
/** Set once the script runs: the parts that only make sense WITH JavaScript render after this. */
let enhanced = $state(false);
onMount(() => {
  enhanced = true;
});
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
/**
 * Tool choices saved over fetch replace the list too (`patched`, see `setEnabled`); a fresh test
 * clears them, because the API just rewrote the rows — with the disabled ones kept disabled.
 */
let patched = $state<Tool[] | null>(null);
const tools = $derived<Tool[]>(patched ?? (tested?.ok ? tested.tools : m.tools));
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
/**
 * Status filter beside the search: all / enabled only / disabled only. Same shape as `q` — a
 * `<select>` in the same GET form, read back from `?status=` so the server-rendered table is
 * already narrowed; with JavaScript `onchange` narrows it in place. Combined with the header
 * checkbox this is how "disable everything except…" or "re-enable what I turned off" gets done.
 */
type StatusFilter = 'all' | 'on' | 'off';
const statusOf = (v: string | null): StatusFilter => (v === 'on' || v === 'off' ? v : 'all');
let statusFilter = $state<StatusFilter>(statusOf(page.url.searchParams.get('status')));
const filtering = $derived(needle !== '' || statusFilter !== 'all');
const shown = $derived(
  tools.filter(
    (tl) =>
      (statusFilter === 'all' || tl.enabled === (statusFilter === 'on')) &&
      (!needle ||
        `${tl.name} ${tl.wireName} ${tl.description ?? ''}`.toLowerCase().includes(needle)),
  ),
);
/** With JavaScript the box has already filtered as it was typed; Enter must not reload. */
const searchSubmit = (event: SubmitEvent) => event.preventDefault();

/**
 * Which tools the assistant may use (I-5). Every discovered tool starts enabled; unticking one
 * keeps it out of the assistant's tool list (the tool source skips `enabled = false`) and out of
 * `/v1/tools` and `/v1/mcp`, and a re-test keeps the choice. There is no save button: a checkbox
 * saves itself the moment it changes, through `POST /m/ai/mcps/[id]/tools` (a JSON route in the
 * web app) onto the API's `PUT /v1/m/ai/mcps/:id/tools`. The header checkbox applies one choice
 * to every row currently SHOWN — with a search active that is the narrowed set, which is what
 * "select all" means to someone looking at a filtered table.
 *
 * The base still works without JavaScript (L-22): the table is a `?/tools` form, every row posts
 * its id and every ticked row posts it again under `checked`, and the `<noscript>` button applies
 * the difference through the form action — which calls the same API endpoint.
 *
 * The choice is drawn at once (optimistic), then replaced by the list the server answers with,
 * so what the table shows is what is stored — including rows the page did not know about. Only
 * the LATEST answer is applied: two quick ticks are two requests, and an earlier answer that
 * arrives late must not undraw the later tick.
 */
let pending = $state(0);
let seq = 0;
let toolsSaved = $state(false);
let toolsError = $state<string | null>(null);
const enabledCount = $derived(tools.filter((tl) => tl.enabled).length);
const shownEnabled = $derived(shown.filter((tl) => tl.enabled).length);
const allShownOn = $derived(shown.length > 0 && shownEnabled === shown.length);
const someShownOn = $derived(shownEnabled > 0 && shownEnabled < shown.length);

async function setEnabled(ids: string[], enabled: boolean) {
  if (ids.length === 0) return;
  const mine = ++seq;
  const before = tools;
  const want = new Set(ids);
  patched = before.map((tl) => (want.has(tl.id) ? { ...tl, enabled } : tl));
  pending += 1;
  toolsSaved = false;
  toolsError = null;
  try {
    const body = new FormData();
    body.set('_csrf', data.csrf);
    body.set('enabled', String(enabled));
    for (const id of ids) body.append('ids', id);
    const res = await fetch(`/m/ai/mcps/${m.id}/tools`, { method: 'POST', body });
    const json = (await res.json()) as { ok: boolean; error?: string; tools?: Tool[] };
    if (!res.ok || !json.ok || !json.tools) throw new Error(json.error ?? `HTTP ${res.status}`);
    if (mine === seq) {
      patched = json.tools;
      toolsSaved = true;
    }
  } catch (err) {
    if (mine === seq) {
      patched = before;
      toolsError = err instanceof Error ? err.message : String(err);
    }
  } finally {
    pending -= 1;
  }
}
const toggleOne = (tl: Tool) => (event: Event) =>
  setEnabled([tl.id], (event.currentTarget as HTMLInputElement).checked);
const toggleShown = (event: Event) =>
  setEnabled(
    shown.map((tl) => tl.id),
    (event.currentTarget as HTMLInputElement).checked,
  );

async function runTest(event: SubmitEvent) {
  event.preventDefault();
  const el = event.currentTarget as HTMLFormElement;
  testing = true;
  try {
    const res = await fetch(`/m/ai/mcps/${m.id}/test`, { method: 'POST', body: new FormData(el) });
    const body = (await res.json()) as Tested & { error?: string };
    if (res.ok) patched = null;
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
      class="[&_button]:cursor-pointer"
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
          <Button type="submit" variant="outline" size="sm" class="cursor-pointer" disabled={testing} aria-busy={testing} data-testid="mcp-test">
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
          class="h-8 w-56 rounded-md border border-input bg-background px-3 text-sm"
          data-testid="mcp-tool-search"
        />
        <label class="sr-only" for="mcp-tool-status">{t('ai.mcps.filter_status')}</label>
        <Select id="mcp-tool-status" name="status" bind:value={statusFilter} class="h-8 w-auto" data-testid="mcp-tool-status">
          <option value="all">{t('ai.mcps.filter_all')}</option>
          <option value="on">{t('ai.mcps.filter_enabled')}</option>
          <option value="off">{t('ai.mcps.filter_disabled')}</option>
        </Select>
        <!-- Only the no-JavaScript path needs it; with JavaScript the list is already narrowed. -->
        <noscript>
          <Button type="submit" variant="outline" size="sm" class="cursor-pointer"><Icon name="search" size={16} />{t('common.apply')}</Button>
        </noscript>
      </form>
      <p class="text-sm text-muted-foreground" data-testid="mcp-tools-count">
        {#if filtering}{t('ai.mcps.tools_filtered', { shown: shown.length, total: tools.length })}
        {:else}{t('ai.mcps.tools_available', { count: tools.length })}{/if}
        {#if tools.length}<span class="ms-1" data-testid="mcp-tools-enabled">· {t('ai.mcps.tools_enabled_count', { enabled: enabledCount })}</span>{/if}
        {#if syncedAt}<span class="ms-1">· {fmt(syncedAt)}</span>{/if}
        {#if tested?.ok}<span class="ms-1">· {tested.ms} ms</span>{/if}
      </p>
    </div>
    {#if tested?.ok}
      <p class="notice" data-testid="mcp-test-ok">{t('ai.mcps.tested_ok')} {tested.tools.length} · {tested.ms} ms</p>
    {:else if failure}
      <p class="error" role="alert" data-testid="mcp-test-fail">{t('ai.mcps.tested_fail')}: {failure}</p>
    {/if}
    {#if manage && tools.length}
      <p class="mb-2 text-sm text-muted-foreground">{t('ai.mcps.tools_hint')}</p>
    {/if}
    {#if toolsError}
      <p class="error" role="alert" data-testid="mcp-tools-fail">{t('ai.mcps.tools_save_failed')}: {toolsError}</p>
    {:else if pending > 0}
      <p class="text-sm text-muted-foreground" role="status" data-testid="mcp-tools-saving">{t('ai.mcps.tools_saving')}</p>
    {:else if toolsSaved || form?.toolsSaved}
      <p class="notice" role="status" data-testid="mcp-tools-saved">{t('ai.mcps.tools_saved')}</p>
    {/if}
    <!--
      Base: one `?/tools` form around the table, applied by the <noscript> button. Enhanced: each
      checkbox saves itself over fetch the moment it changes, so the button is never needed.
    -->
    <form method="POST" action="?/tools" aria-busy={pending > 0} data-enhanced={enhanced ? 'true' : undefined}>
      {#if manage}<Csrf token={data.csrf} />{/if}
      <Table caption={t('ai.mcps.tools')}>
        <thead>
          <tr>
            {#if manage}
              <th class="w-8">
                {#if enhanced}
                  <Checkbox
                    checked={allShownOn}
                    indeterminate={someShownOn}
                    disabled={shown.length === 0}
                    onchange={toggleShown}
                    aria-label={t('ai.mcps.select_all')}
                    title={t('ai.mcps.select_all')}
                    class="cursor-pointer align-middle"
                    data-testid="mcp-tools-all"
                  />
                {/if}
              </th>
            {/if}
            <th>{t('ai.mcps.tool')}</th><th>{t('ai.mcps.wire_hint')}</th><th>{t('ai.mcps.description')}</th>
          </tr>
        </thead>
        <tbody>
          {#each shown as tl (tl.id)}
            <tr data-testid="mcp-tool-row" data-enabled={tl.enabled ? 'true' : 'false'}>
              {#if manage}
                <td class="w-8">
                  <input type="hidden" name="ids" value={tl.id} />
                  <Checkbox
                    name="checked"
                    value={tl.id}
                    checked={tl.enabled}
                    onchange={toggleOne(tl)}
                    aria-label={t('ai.mcps.tool_toggle', { name: tl.name })}
                    class="cursor-pointer align-middle"
                    data-testid="mcp-tool-toggle"
                  />
                </td>
              {/if}
              <td class="font-medium">{tl.name}{#if !tl.enabled} <Badge variant="secondary">{t('ai.mcps.disabled')}</Badge>{/if}</td>
              <td><code>{tl.wireName}</code></td>
              <td class="text-muted-foreground">{tl.description ?? '—'}</td>
            </tr>
          {:else}
            <tr><td colspan={manage ? 4 : 3} class="py-6 text-center text-muted-foreground">{filtering ? t('ai.mcps.tools_no_match') : status ? t('ai.mcps.tools_empty') : t('ai.mcps.never')}</td></tr>
          {/each}
        </tbody>
      </Table>
      {#if manage && tools.length}
        <!-- Only the no-JavaScript path needs it; with JavaScript every checkbox has already saved. -->
        <noscript>
          <div class="mt-3">
            <Button type="submit" variant="outline" size="sm" class="cursor-pointer"><Icon name="check" size={16} />{t('common.apply')}</Button>
          </div>
        </noscript>
      {/if}
    </form>
  </Card>
  {#if can('ai.mcp.manage')}
    <Card>
      <ConfirmDelete class="cursor-pointer" csrf={data.csrf} href={`/m/ai/mcps/${m.id}?confirm=delete#confirm-delete`} cancelHref={`/m/ai/mcps/${m.id}`} confirming={data.confirmDelete || form?.code === 'confirm_failed'} error={form?.code === 'confirm_failed' ? form.error : null} description={t('ai.mcps.delete_confirm_lead', { name: m.name })} />
    </Card>
  {/if}
</div>

<style>
  /*
   * Tombol konfirmasi hapus tak bisa dicapai kelas utilitas di atas: pada jalur tanpa JavaScript
   * ia dirender di dalam ConfirmDelete, dan pada jalur dialog bits-ui memasangnya lewat portal ke
   * <body> — di luar pohon `.page` ini.
   */
  :global([data-dialog-content] button),
  :global(#confirm-delete button) { cursor: pointer; }
</style>
