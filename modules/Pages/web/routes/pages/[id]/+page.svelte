<script lang="ts">
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDelete,
  Csrf,
  Field,
  FormBuilder,
  Icon,
  Input,
  toast,
} from '@core/ui';
import { enhance } from '$app/forms';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import FeaturedImage from '../../../lib/FeaturedImage.svelte';
import MarkdownEditor from '../../../lib/MarkdownEditor.svelte';
import { pageFields, slugField } from '../_form.ts';

/**
 * Edit a page. The slug has a form of its own — the permalink card — because changing it is not
 * an ordinary edit: on a page that has been published, the old URL keeps answering with a 301 to
 * the new one. That form is two layers over one action (`?/slug`): a plain POST without
 * JavaScript, and with it a fetch that updates the permalink, the redirect list and the page
 * title in place and says what happened in a toast — no reload.
 */
let { data, form } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const r = $derived(data.row);
const editable = $derived(can('pages.page.edit'));
const published = $derived(r.status === 'published');
const permalink = $derived(`${data.origin}/${r.slug}`);
const slugDef = $derived(slugField(t));

const mainErrors = $derived(
  (!form?.slugForm && !form?.imageForm && form?.details && typeof form.details === 'object'
    ? form.details
    : {}) as Record<string, string>,
);
const slugErrorText = $derived(
  form?.slugForm
    ? ((form.details as Record<string, string> | null)?.slug ?? form.error ?? null)
    : null,
);
/** What the slug box shows: the rejected value after a failed post, else the current slug. */
const slugValue = $derived(
  form?.slugForm
    ? String((form.values as Record<string, unknown> | undefined)?.slug ?? '')
    : r.slug,
);
const change = $derived(form?.slugChange ?? null);
/** What the featured image card's last post answered (the no-JavaScript notice and errors). */
const imageResult = $derived(
  form?.imageForm || form?.imageSaved
    ? {
        saved: (form?.imageSaved as string | undefined) ?? null,
        error: form?.imageForm ? ((form?.error as string | undefined) ?? null) : null,
        alt: form?.imageForm
          ? (((form?.values as Record<string, unknown> | undefined)?.alt as string | undefined) ??
            null)
          : null,
      }
    : undefined,
);

let slugBusy = $state(false);
/** Flipped on mount, so a test can tell the fetch layer from the plain form that answers before it. */
let hydrated = $state(false);
$effect(() => {
  hydrated = true;
});

function permalinkOverFetch(node: HTMLFormElement) {
  return enhance(node, () => {
    slugBusy = true;
    return async ({ result, update }) => {
      // Re-runs `load` (new slug, new redirect list) and applies the action result in place.
      await update({ reset: false });
      slugBusy = false;
      if (result.type !== 'success') return;
      const c = (
        result.data as
          | { slugChange?: { changed: boolean; redirected: boolean; from: string; to: string } }
          | undefined
      )?.slugChange;
      if (!c) return;
      if (!c.changed) {
        toast({ title: t('pages.permalink.unchanged') });
        return;
      }
      toast(
        {
          variant: 'success',
          title: t('pages.permalink.changed', { to: `/${c.to}` }),
          description: c.redirected
            ? t('pages.permalink.redirected', { from: `/${c.from}`, to: `/${c.to}` })
            : t('pages.permalink.not_redirected'),
        },
        8000,
      );
    };
  });
}
</script>

<svelte:head><title>{r.title}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="flex items-center gap-3">{r.title} <Badge variant={published ? 'success' : 'secondary'}>{t(`pages.status.${published ? 'published' : 'draft'}`)}</Badge></h1>
    {#if published}<Button href={`/${r.slug}`} variant="outline" size="sm" target="_blank" rel="noopener"><Icon name="external-link" size={16} />{t('pages.edit.open')}</Button>{/if}
  </div>


  <Card title={t('pages.permalink.title')} description={t('pages.permalink.lead')}>
    <p class="mb-4 break-all font-mono text-sm" data-testid="pages-permalink">
      {#if published}<a href={permalink} target="_blank" rel="noopener">{permalink}</a>{:else}{permalink}{/if}
    </p>
    {#if change?.changed}
      <!-- The durable outcome, for a post without JavaScript (and for screen readers after the toast). -->
      <Alert variant="success" class="mb-4">
        <span data-testid="pages-permalink-notice">{t('pages.permalink.changed', { to: `/${change.to}` })} {change.redirected ? t('pages.permalink.redirected', { from: `/${change.from}`, to: `/${change.to}` }) : t('pages.permalink.not_redirected')}</span>
      </Alert>
    {/if}
    {#if editable}
      <form method="POST" action="?/slug" use:permalinkOverFetch data-testid="pages-permalink-form" data-enhanced={hydrated ? 'true' : null} aria-busy={slugBusy ? 'true' : undefined}>
        <Csrf token={data.csrf} />
        <Field label={slugDef.label} for="pages-slug" hint={t('pages.permalink.slug_hint')} error={slugErrorText}>
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-sm text-muted-foreground" aria-hidden="true">/</span>
            <Input id="pages-slug" name="slug" value={slugValue} required maxlength={slugDef.maxlength} pattern={slugDef.pattern} autocomplete="off" spellcheck="false" class="min-w-56 flex-1 font-mono" aria-invalid={slugErrorText ? 'true' : undefined} />
            <Button type="submit" variant="outline" disabled={slugBusy}><Icon name={slugBusy ? 'loader' : 'link'} size={16} class={slugBusy ? 'animate-spin' : ''} />{t('pages.permalink.submit')}</Button>
          </div>
        </Field>
      </form>
    {/if}

    <div class="mt-6">
      <h3 class="text-sm font-semibold">{t('pages.redirects.title')}</h3>
      {#if r.redirects.length}
        <p class="mt-1 text-sm text-muted-foreground">{published ? t('pages.redirects.lead') : t('pages.redirects.inactive')}</p>
        <ul class="mt-3 grid gap-1.5 font-mono text-sm" data-testid="pages-redirects">
          {#each r.redirects as x (x.oldSlug)}
            <li class="flex flex-wrap items-center gap-2"><span>/{x.oldSlug}</span><Icon name="arrow-right" size={14} class="text-muted-foreground rtl:rotate-180" /><span>/{r.slug}</span><Badge variant="outline">301</Badge></li>
          {/each}
        </ul>
      {:else}
        <p class="mt-1 text-sm text-muted-foreground" data-testid="pages-redirects-empty">{t('pages.redirects.empty')}</p>
      {/if}
    </div>
  </Card>

  <Card title={t('pages.image.title')} description={t('pages.image.lead')}>
    <FeaturedImage image={r.image} csrf={data.csrf} {editable} title={r.title} summary={r.summary} host={new URL(data.origin).host} {published} fallback={data.shareDefault} result={imageResult} />
  </Card>

  <Card>
    <FormBuilder fields={pageFields(t, { slug: false })} values={r as unknown as Record<string, unknown>} errors={mainErrors} csrf={data.csrf} action="?/save" ajax columns={2} readonly={!editable} cancelHref="/m/pages/pages" cancelLabel={t('common.back')} notice={form?.saved || data.saved ? t('pages.list.saved') : null} error={form?.error && !form?.slugForm && !form?.imageForm && form.code !== 'confirm_failed' && Object.keys(mainErrors).length === 0 ? form.error : null}>
      {#snippet extra()}
        <MarkdownEditor name="body" label={t('pages.field.body')} value={!form?.slugForm && form?.values ? ((form.values as Record<string, unknown>).body as string | undefined) : r.body} error={mainErrors.body} readonly={!editable} />
      {/snippet}
    </FormBuilder>
  </Card>

  {#if can('pages.page.manage')}
    <Card><ConfirmDelete csrf={data.csrf} href={`/m/pages/pages/${r.id}?confirm=delete#confirm-delete`} cancelHref={`/m/pages/pages/${r.id}`} confirming={data.confirmDelete || form?.code === 'confirm_failed'} error={form?.code === 'confirm_failed' ? form.error : null} /></Card>
  {/if}
</div>
