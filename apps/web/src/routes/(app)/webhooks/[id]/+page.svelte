<script lang="ts">
import type { SubmitFunction } from '@sveltejs/kit';
import { applyAction, enhance } from '$app/forms';
import Csrf from '$lib/components/Csrf.svelte';
import { FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, ConfirmDelete, Table, toast } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import { webhookFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const locale = useLocale();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const w = $derived(data.webhook);

/**
 * Ping and rotation are one-shot actions whose whole answer fits on this page, so with JavaScript
 * they run over `fetch` (L-20): a spinner on the button, the result in place, a toast — and, for
 * rotation, a new secret that never travels through the URL. Both forms are ordinary POSTs first;
 * without JavaScript the server still re-renders the page with exactly the same two outcomes.
 */
type TestResult = { ok: boolean; status: number | null; error: string | null; ms: number };
let busy = $state<'test' | 'rotate' | null>(null);
let tested = $state<TestResult | null>(null);
let rotated = $state<string | null>(null);
let actionError = $state<string | null>(null);
// What JavaScript just fetched wins; otherwise whatever the no-JS round trip left in `form`.
const testResult = $derived<TestResult | null>(tested ?? form?.tested ?? null);
const newSecret = $derived<string | null>(rotated ?? form?.rotated?.secret ?? null);

/** Shared tail of both enhanced submits: clear the spinner, keep server failures visible. */
type Enhanced = Exclude<Awaited<ReturnType<SubmitFunction>>, void>;
const finish =
  (apply: (data: Record<string, unknown>) => void): Enhanced =>
  async ({ result }) => {
    busy = null;
    if (result.type === 'success') apply((result.data ?? {}) as Record<string, unknown>);
    else if (result.type === 'failure') {
      const message = (result.data as { error?: string } | undefined)?.error;
      actionError = message ?? t('common.action_failed');
      toast({ title: actionError, variant: 'error' });
    } else await applyAction(result); // redirect (session expired) or a thrown error
  };
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID') : '—';
const badge = (s: string) =>
  s === 'delivered' ? 'success' : s === 'failed' ? 'destructive' : 'secondary';
</script>

<svelte:head><title>{w.name}</title></svelte:head>

<!-- Shown once, wherever the secret came from: the create redirect, or a rotation on this page. -->
{#snippet secretPanel(secret: string)}
  <div class="notice" role="status" data-testid="webhook-secret">
    <p class="font-medium">{t('webhooks.detail.secret_title')}</p>
    <code class="mt-2 block select-all break-all rounded-md border bg-background px-3 py-2 text-sm">{secret}</code>
    <p class="mt-2 text-sm text-muted-foreground">{t('webhooks.detail.verify_1')}<code>HMAC_SHA256(secret, `${'{'}X-CRK-Timestamp{'}'}.${'{'}body{'}'}`)</code>{t('webhooks.detail.verify_2')}<code>X-CRK-Signature</code>{t('webhooks.detail.verify_3')}<code>sha256=</code>{t('webhooks.detail.verify_4')}</p>
  </div>
{/snippet}

<div class="page">
  <div class="flex flex-wrap items-center gap-3">
    <h1>{w.name}</h1>
    {#if w.lastStatus === 'ok'}<Badge variant="success">ok</Badge>{:else if w.lastStatus === 'error'}<Badge variant="destructive">error</Badge>{/if}
    {#if !w.enabled}<Badge variant="secondary">{t('common.inactive')}</Badge>{/if}
  </div>
  {#if data.secret}{@render secretPanel(data.secret)}{/if}
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
        <form
          method="POST"
          action="?/test"
          use:enhance={() => {
            busy = 'test';
            tested = null;
            actionError = null;
            return finish((d) => {
              const r = d.tested as TestResult;
              tested = r;
              toast({
                title: t('webhooks.detail.send_test'),
                description: r.ok
                  ? t('webhooks.detail.test_ok', { status: r.status ?? '', ms: r.ms })
                  : t('webhooks.detail.test_fail', { error: r.error ?? '' }),
                variant: r.ok ? 'success' : 'error',
              });
            });
          }}
        >
          <Csrf token={data.csrf} />
          <Button type="submit" variant="outline" size="sm" disabled={busy !== null}>
            <Icon name={busy === 'test' ? 'refresh' : 'send'} size={16} class={busy === 'test' ? 'animate-spin' : ''} />
            {busy === 'test' ? t('common.running') : t('webhooks.detail.send_test')}
          </Button>
        </form>
        <form
          method="POST"
          action="?/rotate"
          use:enhance={() => {
            busy = 'rotate';
            actionError = null;
            return finish((d) => {
              rotated = (d.rotated as { secret: string }).secret;
              toast({ title: t('webhooks.detail.rotated'), variant: 'warning' });
            });
          }}
        >
          <Csrf token={data.csrf} />
          <Button type="submit" variant="outline" size="sm" disabled={busy !== null}>
            <Icon name={busy === 'rotate' ? 'refresh' : 'key'} size={16} class={busy === 'rotate' ? 'animate-spin' : ''} />
            {busy === 'rotate' ? t('common.running') : t('webhooks.detail.rotate')}
          </Button>
        </form>
      </div>
      {#if actionError}<p class="error mt-3" role="alert">{actionError}</p>{/if}
      {#if testResult}
        {#if testResult.ok}
          <p class="notice mt-3" role="status" data-testid="webhook-test-ok">{t('webhooks.detail.test_ok', { status: testResult.status ?? '', ms: testResult.ms })}</p>
        {:else}
          <p class="error mt-3" role="alert" data-testid="webhook-test-fail">{t('webhooks.detail.test_fail', { error: testResult.error ?? '' })}</p>
        {/if}
      {/if}
      {#if newSecret}<div class="mt-3">{@render secretPanel(newSecret)}</div>{/if}
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
      <ConfirmDelete csrf={data.csrf} href={`/webhooks/${w.id}?confirm=delete#confirm-delete`} cancelHref={`/webhooks/${w.id}`} confirming={data.confirmDelete || form?.code === 'confirm_failed'} error={form?.code === 'confirm_failed' ? form.error : null} label={t('webhooks.detail.delete')} description={t('webhooks.detail.delete_confirm_lead', { name: w.name })} />
    </Card>
  {/if}
</div>
