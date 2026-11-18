<script lang="ts">
import { Alert, Button, Csrf, Field, Icon, Input, toast } from '@core/ui';
import { enhance } from '$app/forms';
import { useT } from '$lib/i18n';

/**
 * Featured image card of the page editor. One form, two layers: a plain multipart POST to
 * `?/image` (upload + alt) or `?/imageRemove` without JavaScript; with it, the same actions over
 * fetch — the new image, the share preview and a toast appear in place. Picking a file shows it
 * immediately (a local object URL) with its pixel size, so a too-small picture is caught before
 * it is uploaded. The share preview mirrors what Facebook/WhatsApp/LinkedIn draw from og:*: a
 * published page's image is shown as its real 1200 × 630 card (`/v1/opengraph/<fileId>`, made by
 * the core); a draft's image (private until the page is published, so it has no card yet) and a
 * picked, not yet uploaded file as the same layout drawn in CSS — cropped to fill when it is close
 * to 1.91:1, otherwise whole on a blurred copy of itself.
 */
interface ImageView {
  fileId: string;
  url: string;
  width: number | null;
  height: number | null;
  mime: string;
  alt: string | null;
}
interface Props {
  image: ImageView | null;
  csrf: string;
  editable: boolean;
  /** For the share preview. */
  title: string;
  summary: string | null;
  host: string;
  published: boolean;
  /** The site's default share image, shown in the preview while the page has none of its own. */
  fallback: string;
  /** Action result for this card (no-JS path), if any. */
  result?: { saved?: string | null; error?: string | null; alt?: string | null } | undefined;
}
let { image, csrf, editable, title, summary, host, published, fallback, result }: Props = $props();
const t = useT();

/** Recommended by every network for the large card: 1.91:1, at least 1200 wide. */
const IDEAL = { width: 1200, height: 630 };
const MIN = { width: 600, height: 315 };
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

let picked = $state<{ url: string; width: number; height: number; name: string } | null>(null);
let busy = $state(false);
let fileInput = $state<HTMLInputElement | null>(null);
let hydrated = $state(false);
$effect(() => {
  hydrated = true;
});
// Release the local preview URL when it is replaced or the card goes away.
$effect(() => {
  const url = picked?.url;
  return () => {
    if (url) URL.revokeObjectURL(url);
  };
});

function pick(event: Event) {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (!file) {
    picked = null;
    return;
  }
  const url = URL.createObjectURL(file);
  const probe = new Image();
  probe.onload = () => {
    picked = { url, width: probe.naturalWidth, height: probe.naturalHeight, name: file.name };
  };
  probe.onerror = () => {
    picked = { url, width: 0, height: 0, name: file.name };
  };
  probe.src = url;
}

const shown = $derived(
  picked
    ? { url: picked.url, width: picked.width, height: picked.height }
    : image
      ? { url: image.url, width: image.width, height: image.height }
      : null,
);
/** Same tolerance as the core's card maker (apps/api/src/lib/og-image.ts): ±15 % of 1.91:1. */
const nearCard = (w: number, h: number) =>
  Math.abs(w / h / (IDEAL.width / IDEAL.height) - 1) <= 0.15;
/**
 * A note, not a refusal. Too small: the card enlarges it at most 2×, so it stays soft (warning).
 * Far from 1.91:1: nothing is cut off any more, it is shown whole on a blurred background (info).
 */
const sizeNote = $derived.by(() => {
  if (!shown?.width || !shown.height) return null;
  if (shown.width < MIN.width || shown.height < MIN.height)
    return { variant: 'warning' as const, text: t('pages.image.too_small') };
  if (!nearCard(shown.width, shown.height))
    return { variant: 'info' as const, text: t('pages.image.ratio') };
  return null;
});
/** The saved image's share card, as crawlers fetch it — only a published page's image has one. */
const card = $derived(
  image && published && !picked ? `/v1/opengraph/${encodeURIComponent(image.fileId)}` : null,
);
/** Otherwise the card is drawn in CSS: framed (blurred backdrop) unless close to 1.91:1. */
const framed = $derived(shown?.width && shown.height ? !nearCard(shown.width, shown.height) : true);

function overFetch(node: HTMLFormElement) {
  return enhance(node, ({ action }) => {
    busy = true;
    const removing = action.search.includes('imageRemove');
    return async ({ result: r, update }) => {
      await update({ reset: true });
      busy = false;
      if (r.type === 'success') {
        picked = null;
        if (fileInput) fileInput.value = '';
        toast({
          variant: 'success',
          title: removing ? t('pages.image.removed') : t('pages.image.saved'),
        });
      }
    };
  });
}
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
  <div class="grid gap-4">
    {#if shown}
      <figure class="max-w-2xl overflow-hidden rounded-lg border bg-muted" data-testid="pages-image-current">
        <img src={shown.url} alt={image?.alt ?? ''} class="aspect-[1.91/1] w-full object-cover" />
        <figcaption class="flex flex-wrap items-center gap-2 border-t bg-card px-3 py-2 text-xs text-muted-foreground">
          {#if picked}<span class="font-medium text-foreground">{t('pages.image.selected')}: {picked.name}</span>{/if}
          {#if shown.width && shown.height}<span data-testid="pages-image-size">{shown.width} × {shown.height} px</span>{/if}
        </figcaption>
      </figure>
      {#if sizeNote}<Alert variant={sizeNote.variant}>{sizeNote.text}</Alert>{/if}
    {:else}
      <div class="flex aspect-[1.91/1] max-w-2xl flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground" data-testid="pages-image-empty">
        <Icon name="image" size={28} />
        <span>{t('pages.image.empty')}</span>
      </div>
    {/if}

    {#if result?.error}<p class="error" role="alert">{result.error}</p>{/if}
    {#if result?.saved && !hydrated}<p class="notice" role="status">{result.saved === 'removed' ? t('pages.image.removed') : t('pages.image.saved')}</p>{/if}

    {#if editable}
      <form method="POST" action="?/image" enctype="multipart/form-data" use:overFetch class="grid gap-4" data-testid="pages-image-form" data-enhanced={hydrated ? 'true' : null} aria-busy={busy ? 'true' : undefined}>
        <Csrf token={csrf} />
        <Field label={t('pages.image.file')} for="pages-image-file" hint={t('pages.image.hint', { width: IDEAL.width, height: IDEAL.height })}>
          <input bind:this={fileInput} id="pages-image-file" type="file" name="file" accept={ACCEPT} onchange={pick} class="block w-full text-sm file:me-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-accent" />
        </Field>
        <Field label={t('pages.image.alt')} for="pages-image-alt" hint={t('pages.image.alt_hint')}>
          <Input id="pages-image-alt" name="alt" maxlength={191} value={result?.alt ?? image?.alt ?? ''} />
        </Field>
        <div class="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy}><Icon name={busy ? 'loader' : 'upload'} size={16} class={busy ? 'animate-spin' : ''} />{t('pages.image.save')}</Button>
          {#if image}
            <Button type="submit" variant="outline" formaction="?/imageRemove" disabled={busy} data-testid="pages-image-remove"><Icon name="trash" size={16} />{t('pages.image.remove')}</Button>
          {/if}
        </div>
      </form>
    {/if}
  </div>

  <!-- What a share looks like: the og:image, the domain, og:title and og:description. -->
  <div>
    <p class="mb-2 text-sm font-medium">{t('pages.image.share_preview')}</p>
    <div class="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs" data-testid="pages-share-preview">
      {#if shown && !card}
        <div class="relative aspect-[1.91/1] w-full overflow-hidden bg-muted" data-testid="pages-share-local">
          {#if framed}<img src={shown.url} alt="" aria-hidden="true" class="absolute inset-0 h-full w-full scale-110 object-cover blur-xl brightness-[0.6]" />{/if}
          <img src={shown.url} alt="" class={`relative h-full w-full ${framed ? 'object-contain' : 'object-cover'}`} />
        </div>
      {:else}
        <img src={card ?? fallback} alt="" class="aspect-[1.91/1] w-full object-cover" data-default={card ? null : 'true'} />
      {/if}
      <div class="grid gap-1 border-t bg-muted/40 px-3 py-2.5">
        <span class="text-xs uppercase tracking-wide text-muted-foreground">{host}</span>
        <span class="line-clamp-2 text-sm font-semibold">{title}</span>
        {#if summary}<span class="line-clamp-2 text-xs text-muted-foreground">{summary}</span>{/if}
      </div>
    </div>
    {#if !shown}<p class="mt-2 text-xs text-muted-foreground" data-testid="pages-share-default">{t('pages.image.share_default')}</p>{/if}
    <p class="mt-2 text-xs text-muted-foreground">{published ? t('pages.image.share_note') : t('pages.image.share_draft')}</p>
  </div>
</div>
