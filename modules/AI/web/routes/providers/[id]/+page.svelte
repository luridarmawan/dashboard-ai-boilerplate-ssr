<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, Table } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import { modelLines, providerFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const p = $derived(data.provider);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
const money = (n: number) => (n ? n.toFixed(n < 0.01 ? 4 : 2) : '—');
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
    <Table caption={t('ai.providers.price_list')}>
      <thead><tr><th>Model</th><th>Label</th><th class="text-right">{t('ai.providers.price_in')}</th><th class="text-right">{t('ai.providers.price_out')}</th></tr></thead>
      <tbody>
        {#each p.models as m (m.id)}
          <tr><td><code>{m.model}</code>{#if m.model === p.defaultModel} <Badge variant="outline">{t('ai.providers.default')}</Badge>{/if}</td><td class="text-muted-foreground">{m.label ?? '—'}</td><td class="text-right">{money(m.priceIn)}</td><td class="text-right">{money(m.priceOut)}</td></tr>
        {/each}
      </tbody>
    </Table>
  </Card>
  <Card title={t('ai.providers.test')}>
    {#if can('ai.provider.manage')}
      <form method="POST" action="?/test" class="mb-3"><Csrf token={data.csrf} /><Button type="submit" variant="outline" size="sm"><Icon name="refresh" size={16} />{t('ai.providers.test')}</Button></form>
    {/if}
    {#if form?.tested}
      {#if form.tested.ok}
        <p class="notice" data-testid="provider-test-ok">{t('ai.providers.tested_ok')} {form.tested.models.length} · {form.tested.ms} ms</p>
        {#if form.tested.models.length}
          <p class="text-xs text-muted-foreground">{t('ai.providers.tested_models_hint')}</p>
          <ul class="mt-1 flex flex-wrap gap-1">{#each form.tested.models as id (id)}<li><code class="rounded border px-1.5 py-0.5 text-xs">{id}</code></li>{/each}</ul>
        {/if}
      {:else}
        <p class="error" role="alert" data-testid="provider-test-fail">{t('ai.providers.tested_fail')}: {form.tested.error}</p>
      {/if}
    {:else if p.lastStatus === 'error' && p.lastError}
      <p class="error" role="alert">{t('ai.providers.tested_fail')}: {p.lastError}</p>
    {:else}
      <p class="text-sm text-muted-foreground">{t('ai.providers.test_hint')}</p>
    {/if}
  </Card>
  {#if can('ai.provider.manage')}
    <Card>
      <form method="POST" action="?/delete"><Csrf token={data.csrf} /><Button type="submit" variant="destructive"><Icon name="trash" size={16} />{t('common.delete')}</Button></form>
    </Card>
  {/if}
</div>
