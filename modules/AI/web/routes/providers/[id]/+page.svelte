<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, ConfirmDelete, Table } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import Capabilities from '../../../lib/Capabilities.svelte';
import { modelLines, providerFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const p = $derived(data.provider);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
const money = (n: number) => (n ? n.toFixed(n < 0.01 ? 4 : 2) : '—');
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID') : '—');

/**
 * The probe over fetch: the card fills in without a page load. The form below is untouched, so
 * with JavaScript off the `?/test` action still runs and still renders through `form.tested` —
 * `tested` simply prefers whatever the fetch produced.
 */
type Tested = {
  ok: boolean;
  error: string | null;
  models: string[];
  ms: number;
  capabilities: Parameters<typeof Capabilities>[1]['capabilities'];
  preferredEndpoint: string | null;
  recommended: boolean;
  steps: { step: string; status: string; ms: number; note: string | null }[];
};
let testing = $state(false);
let live = $state<Tested | null>(null);
const tested = $derived(live ?? (form?.tested as Tested | undefined) ?? null);

/**
 * The same probe for ONE model. Kept per model id rather than as a single "last result", because
 * the point of testing a second model is to compare it with the first — a shared slot would erase
 * the answer the admin is comparing against. `?/testModel` returns one result with JavaScript off;
 * it is folded in under the same key so both paths render through this map.
 */
type ModelTested = {
  model: string;
  ok: boolean;
  error: string | null;
  ms: number;
  capabilities: Tested['capabilities'];
  preferredEndpoint: string | null;
  recommended: boolean;
  testedAt: string;
  steps: Tested['steps'];
};
let testingModel = $state<string | null>(null);
let modelLive = $state<Record<string, ModelTested>>({});
const modelResults = $derived.by(() => {
  const out: Record<string, ModelTested> = { ...modelLive };
  const posted = form?.testedModel as ModelTested | undefined;
  if (posted && !out[posted.model]) out[posted.model] = posted;
  return out;
});

function failedModel(model: string, error: string): ModelTested {
  return {
    model,
    ok: false,
    error,
    ms: 0,
    capabilities: null,
    preferredEndpoint: null,
    recommended: false,
    testedAt: new Date().toISOString(),
    steps: [],
  };
}

async function runModelTest(e: SubmitEvent) {
  e.preventDefault();
  const el = e.currentTarget as HTMLFormElement;
  const body = new FormData(el);
  const model = String(body.get('model') ?? '');
  testingModel = model;
  try {
    const res = await fetch(`/m/ai/providers/${p.id}/model-test`, { method: 'POST', body });
    const json = (await res.json()) as ModelTested & { error?: string };
    modelLive = {
      ...modelLive,
      [model]: res.ok ? json : failedModel(model, json.error ?? `HTTP ${res.status}`),
    };
  } catch (err) {
    modelLive = {
      ...modelLive,
      [model]: failedModel(model, err instanceof Error ? err.message : String(err)),
    };
  } finally {
    testingModel = null;
  }
}

async function runTest(e: SubmitEvent) {
  e.preventDefault();
  const el = e.currentTarget as HTMLFormElement;
  testing = true;
  try {
    const res = await fetch(`/m/ai/providers/${p.id}/test`, {
      method: 'POST',
      body: new FormData(el),
    });
    const body = (await res.json()) as Tested & { error?: string };
    live = res.ok
      ? body
      : ({
          ok: false,
          error: body.error ?? `HTTP ${res.status}`,
          models: [],
          ms: 0,
          capabilities: null,
          preferredEndpoint: null,
          recommended: false,
          steps: [],
        } as Tested);
  } catch (err) {
    live = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      models: [],
      ms: 0,
      capabilities: null,
      preferredEndpoint: null,
      recommended: false,
      steps: [],
    } as Tested;
  } finally {
    testing = false;
  }
}
</script>

<svelte:head><title>{p.name}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3">
    <h1>{p.name}</h1>
    <code class="text-sm">{p.code}</code>
    {#if p.isDefault}<Badge variant="outline">{t('ai.providers.default')}</Badge>{/if}
    {#if p.lastStatus === 'ok'}<Badge variant="success">ok</Badge>{:else if p.lastStatus === 'error'}<Badge variant="destructive">error</Badge>{/if}
  </div>
  <Card>
    <FormBuilder
      fields={providerFields}
      values={{ name: p.name, code: p.code, baseUrl: p.baseUrl, apiKey: '', defaultModel: p.defaultModel, models: modelLines(p.models), enabled: p.enabled, isDefault: p.isDefault }}
      errors={fieldErrors}
      csrf={data.csrf}
      action="?/save"
      columns={2}
      readonly={!can('ai.provider.manage')}
      cancelHref="/m/ai/providers"
      cancelLabel={t('common.back')}
      notice={form?.saved || data.saved ? t('ai.providers.saved') : null}
      error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null}
    />
    <p class="mt-2 text-xs text-muted-foreground">{p.apiKeySet ? t('ai.providers.key_set') : t('ai.providers.no_key_hint')}</p>
  </Card>
  <Card title={t('ai.providers.price_list')}>
    <p class="mb-3 text-xs text-muted-foreground">{t('ai.providers.model_test_hint')} {t('ai.providers.model_default_hint')}</p>
    <Table caption={t('ai.providers.price_list')}>
      <thead><tr><th>Model</th><th>Label</th><th class="text-end">{t('ai.providers.price_in')}</th><th class="text-end">{t('ai.providers.price_out')}</th><th>{t('ai.providers.capabilities')}</th><th></th></tr></thead>
      <tbody>
        {#each p.models as m (m.id)}
          <!-- A fresh probe wins over the stored row; a FAILED one leaves the stored matrix
               standing, exactly as the API does when it records the failure. -->
          {@const r = modelResults[m.model]}
          {@const caps = r?.ok ? r.capabilities : m.capabilities}
          {@const testedAt = r?.testedAt ?? m.capabilitiesAt}
          <tr data-testid="provider-model-row">
            <td><code>{m.model}</code>{#if m.model === p.defaultModel} <Badge variant="outline">{t('ai.providers.default')}</Badge>{/if}</td>
            <td class="text-muted-foreground">{m.label ?? '—'}</td>
            <td class="text-end">{money(m.priceIn)}</td>
            <td class="text-end">{money(m.priceOut)}</td>
            <td>
              <Capabilities capabilities={caps} recommended={r?.ok ? r.recommended : m.recommended} preferredEndpoint={r?.ok ? r.preferredEndpoint : m.preferredEndpoint} compact />
              {#if r && !r.ok}
                <span class="ms-1 text-xs text-destructive" data-testid="model-test-fail">{t('ai.providers.tested_fail')}: {r.error}</span>
              {:else if !r && m.lastStatus === 'error' && m.lastError}
                <span class="ms-1 text-xs text-destructive">{t('ai.providers.tested_fail')}: {m.lastError}</span>
              {/if}
              {#if testedAt}
                <span class="ms-1 text-xs text-muted-foreground">{t('ai.providers.capabilities_at')} {fmt(testedAt)}{#if r?.ms || m.lastProbeMs} · {r?.ms ?? m.lastProbeMs} ms{/if}</span>
              {/if}
            </td>
            <td class="text-end whitespace-nowrap">
              {#if can('ai.provider.manage')}
                <form method="POST" action="?/testModel" onsubmit={runModelTest} class="inline">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="model" value={m.model} />
                  <Button type="submit" variant="outline" size="sm" disabled={testingModel !== null}><Icon name="refresh" size={16} class={testingModel === m.model ? 'animate-spin' : ''} />{testingModel === m.model ? t('common.running') : t('ai.providers.model_test')}</Button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </Table>
  </Card>
  <Card title={t('ai.providers.test')}>
    {#if can('ai.provider.manage')}
      <form method="POST" action="?/test" class="mb-3" onsubmit={runTest}><Csrf token={data.csrf} /><Button type="submit" variant="outline" size="sm" disabled={testing}><Icon name="refresh" size={16} class={testing ? 'animate-spin' : ''} />{testing ? t('common.running') : t('ai.providers.test')}</Button></form>
    {/if}
    {#if tested}
      {#if tested.ok}
        <p class="notice" data-testid="provider-test-ok">{t('ai.providers.tested_ok')} {tested.models.length} · {tested.ms} ms</p>
        <div class="mb-2">
          <Capabilities capabilities={tested.capabilities} recommended={tested.recommended} preferredEndpoint={tested.preferredEndpoint} />
        </div>
        {#if tested.steps.some((s: { status: string }) => s.status === 'error')}
          <!-- A step that timed out is not proof the endpoint is missing; say so rather than let
               the matrix read as a confident negative. -->
          <p class="text-xs text-warning">{t('ai.providers.probe_partial')}</p>
        {/if}
        <ul class="mb-3 text-xs text-muted-foreground">
          {#each tested.steps as s (s.step)}
            <li>
              <code>{s.step}</code>
              <span class={s.status === 'ok' ? 'text-success' : s.status === 'error' ? 'text-destructive' : ''}>{s.status}</span>
              · {s.ms} ms{#if s.note} — {s.note}{/if}
            </li>
          {/each}
        </ul>
        {#if tested.models.length}
          <p class="text-xs text-muted-foreground">{t('ai.providers.tested_models_hint')}</p>
          <ul class="mt-1 flex flex-wrap gap-1">{#each tested.models as id (id)}<li><code class="rounded border px-1.5 py-0.5 text-xs">{id}</code></li>{/each}</ul>
        {/if}
      {:else}
        <p class="error" role="alert" data-testid="provider-test-fail">{t('ai.providers.tested_fail')}: {tested.error}</p>
      {/if}
    {:else if p.capabilities}
      <div class="mb-2"><Capabilities capabilities={p.capabilities} recommended={p.recommended} preferredEndpoint={p.preferredEndpoint} /></div>
      <p class="text-xs text-muted-foreground">{t('ai.providers.capabilities_at')} {fmt(p.capabilitiesAt)}{#if p.lastProbeMs} · {p.lastProbeMs} ms{/if}</p>
      {#if p.lastStatus === 'error' && p.lastError}
        <p class="error mt-2" role="alert">{t('ai.providers.tested_fail')}: {p.lastError}</p>
      {/if}
    {:else if p.lastStatus === 'error' && p.lastError}
      <p class="error" role="alert">{t('ai.providers.tested_fail')}: {p.lastError}</p>
    {:else}
      <p class="text-sm text-muted-foreground">{t('ai.providers.test_hint')}</p>
    {/if}
  </Card>
  {#if can('ai.provider.manage')}
    <Card>
      <ConfirmDelete csrf={data.csrf} href={`/m/ai/providers/${p.id}?confirm=delete#confirm-delete`} cancelHref={`/m/ai/providers/${p.id}`} confirming={data.confirmDelete || form?.code === 'confirm_failed'} error={form?.code === 'confirm_failed' ? form.error : null} description={t('ai.providers.delete_confirm_lead', { name: p.name })} />
    </Card>
  {/if}
</div>
