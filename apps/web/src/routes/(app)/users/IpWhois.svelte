<script lang="ts">
import { useT } from '$lib/i18n';
import type { IpInfo, IpInfoError } from './ip-info/lookup';

/**
 * An IP address with a superscript "?" that tells where it is (city, country, network).
 * Without JavaScript the "?" is a link to `/users/ip-info?ip=…`, a page with the same answer;
 * with it the click fetches that URL as JSON and shows the answer in a popover beside the "?".
 * Answers are kept per address for the life of the page, so re-opening does not ask again.
 */
let { ip }: { ip: string } = $props();
const t = useT();
const answers = new Map<string, { info: IpInfo | null; error: IpInfoError | null }>();

let panel = $state<HTMLDivElement | null>(null);
let loading = $state(false);
let info = $state<IpInfo | null>(null);
let err = $state<IpInfoError | null>(null);
let pos = $state({ top: 0, left: 0 });
const href = $derived(`/users/ip-info?ip=${encodeURIComponent(ip)}`);

async function open(e: MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  // Below the "?", kept inside the viewport (the panel is at most 18rem wide).
  pos = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 296)) };
  panel?.showPopover();
  const cached = answers.get(ip);
  if (cached) {
    info = cached.info;
    err = cached.error;
    return;
  }
  loading = true;
  info = null;
  err = null;
  try {
    const res = await fetch(href, { headers: { accept: 'application/json' } });
    const body = (await res.json()) as IpInfo | { error: IpInfoError };
    if (res.ok) info = body as IpInfo;
    else err = (body as { error?: IpInfoError }).error ?? 'failed';
  } catch {
    err = 'failed';
  } finally {
    loading = false;
  }
  // A failed service may answer next time; a missing or disabled one will not.
  if (err !== 'failed') answers.set(ip, { info, error: err });
}

const place = (i: IpInfo) => [i.city, i.region, i.country].filter(Boolean).join(', ');
</script>

<span class="whitespace-nowrap">{ip}<sup><a
  {href}
  class="ms-0.5 cursor-pointer px-0.5 font-semibold text-muted-foreground no-underline hover:text-foreground"
  title={t('users.ip.lookup', { ip })}
  aria-label={t('users.ip.lookup', { ip })}
  aria-haspopup="dialog"
  data-testid="ip-whois"
  onclick={open}
>?</a></sup></span>
<div
  bind:this={panel}
  popover="auto"
  role="dialog"
  aria-label={t('users.ip.lookup', { ip })}
  class="m-0 w-72 rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-md"
  style={`position: fixed; inset: auto; top: ${pos.top}px; left: ${pos.left}px;`}
  data-testid="ip-whois-panel"
>
  <p class="mb-2 font-medium"><span class="text-muted-foreground">{t('users.ip.title')}</span> <code class="break-all">{ip}</code></p>
  {#if loading}
    <p class="text-muted-foreground" aria-live="polite">{t('users.ip.loading')}</p>
  {:else if err}
    <p class="text-muted-foreground" role="alert">{t(`users.ip.${err}`)}</p>
  {:else if info?.private}
    <p class="text-muted-foreground">{t('users.ip.private')}</p>
  {:else if info}
    <p class="mb-2" data-testid="ip-whois-place">{place(info) || '—'}</p>
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt class="text-muted-foreground">{t('users.ip.city')}</dt><dd>{info.city ?? '—'}</dd>
      <dt class="text-muted-foreground">{t('users.ip.region')}</dt><dd>{info.region ?? '—'}</dd>
      <dt class="text-muted-foreground">{t('users.ip.country')}</dt><dd>{info.country ?? '—'}{info.countryCode ? ` (${info.countryCode})` : ''}</dd>
      <dt class="text-muted-foreground">{t('users.ip.isp')}</dt><dd>{[info.isp, info.asn].filter(Boolean).join(' · ') || '—'}</dd>
    </dl>
  {/if}
</div>
