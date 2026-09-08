<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, Table } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import { webhookFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const locale = useLocale();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const w = $derived(data.webhook);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID') : '—';
const badge = (s: string) =>
  s === 'delivered' ? 'success' : s === 'failed' ? 'destructive' : 'secondary';
</script>

<svelte:head><title>{w.name}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3">
    <h1>{w.name}</h1>
    {#if w.lastStatus === 'ok'}<Badge variant="success">ok</Badge>{:else if w.lastStatus === 'error'}<Badge variant="destructive">error</Badge>{/if}
    {#if !w.enabled}<Badge variant="secondary">{t('common.inactive')}</Badge>{/if}
  </div>
  {#if data.secret}
    <div class="notice" role="status" data-testid="webhook-secret">
      <p class="font-medium">{t('webhooks.detail.secret_title')}</p>
      <code class="mt-2 block select-all break-all rounded-md border bg-background px-3 py-2 text-sm">{data.secret}</code>
      <p class="mt-2 text-sm text-muted-foreground">{t('webhooks.detail.verify_1')}<code>HMAC_SHA256(secret, `${'{'}X-DAB-Timestamp{'}'}.${'{'}body{'}'}`)</code>{t('webhooks.detail.verify_2')}<code>X-DAB-Signature</code>{t('webhooks.detail.verify_3')}<code>sha256=</code>{t('webhooks.detail.verify_4')}</p>
    </div>
  {/if}
  <Card>
    <FormBuilder
      fields={webhookFields(data.events, t)}
      values={{ name: w.name, url: w.url, events: w.events, enabled: w.enabled }}
      errors={fieldErrors}
      csrf={data.csrf}
      action="?/save"
      columns={2}
      readonly={!can('webhook.manage')}
      cancelHref="/webhooks"
      cancelLabel={t('common.back')}
      notice={form?.saved || data.saved ? t('common.saved') : null}
      error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null}
    />
  </Card>
  {#if can('webhook.manage')}
    <Card title={t('webhooks.detail.test_section')}>
      <div class="flex flex-wrap gap-2">
        <form method="POST" action="?/test"><Csrf token={data.csrf} /><Button type="submit" variant="outline" size="sm"><Icon name="send" size={16} />{t('webhooks.detail.send_test')}</Button></form>
        <form method="POST" action="?/rotate"><Csrf token={data.csrf} /><Button type="submit" variant="outline" size="sm"><Icon name="key" size={16} />{t('webhooks.detail.rotate')}</Button></form>
      </div>
      {#if form?.tested}
        {#if form.tested.ok}
          <p class="notice mt-3" data-testid="webhook-test-ok">{t('webhooks.detail.test_ok', { status: form.tested.status ?? '', ms: form.tested.ms })}</p>
        {:else}
          <p class="error mt-3" role="alert" data-testid="webhook-test-fail">{t('webhooks.detail.test_fail', { error: form.tested.error ?? '' })}</p>
        {/if}
      {/if}
    </Card>
  {/if}
  <Card title={t('webhooks.detail.deliveries_title')}>
    {#if form?.retried}<p class="notice mb-3">{t('webhooks.detail.retried')}</p>{/if}
    <Table caption={t('webhooks.detail.deliveries')}>
      <thead><tr><th>{t('webhooks.detail.time')}</th><th>{t('webhooks.detail.event')}</th><th>{t('webhooks.detail.status')}</th><th class="text-end">{t('webhooks.detail.attempts')}</th><th>{t('webhooks.detail.response')}</th><th>{t('webhooks.detail.next')}</th><th></th></tr></thead>
      <tbody>
        {#each w.deliveries as d (d.id)}
          <tr data-testid="delivery-row">
            <td class="whitespace-nowrap text-muted-foreground">{fmt(d.createdAt)}</td>
            <td><code>{d.event}</code></td>
            <td><Badge variant={badge(d.status)}>{d.status}</Badge></td>
            <td class="text-end">{d.attempts}</td>
            <td class="max-w-[16rem] truncate" title={d.lastError ?? ''}>{d.responseStatus ?? '—'}{#if d.lastError} <span class="text-xs text-destructive">{d.lastError}</span>{/if}</td>
            <td class="whitespace-nowrap text-muted-foreground">{d.status === 'pending' ? fmt(d.nextAttemptAt) : d.status === 'delivered' ? fmt(d.deliveredAt) : '—'}</td>
            <td class="text-end">
              {#if can('webhook.manage') && d.status !== 'delivered'}
                <form method="POST" action="?/retry"><Csrf token={data.csrf} /><input type="hidden" name="deliveryId" value={d.id} /><Button type="submit" variant="ghost" size="sm"><Icon name="refresh" size={14} />{t('webhooks.detail.retry')}</Button></form>
              {/if}
            </td>
          </tr>
        {:else}
          <tr><td colspan="7" class="py-6 text-center text-muted-foreground">{t('webhooks.detail.no_deliveries')}</td></tr>
        {/each}
      </tbody>
    </Table>
  </Card>
  {#if can('webhook.manage')}
    <Card>
      <form method="POST" action="?/delete"><Csrf token={data.csrf} /><Button type="submit" variant="destructive"><Icon name="trash" size={16} />{t('webhooks.detail.delete')}</Button></form>
    </Card>
  {/if}
</div>
