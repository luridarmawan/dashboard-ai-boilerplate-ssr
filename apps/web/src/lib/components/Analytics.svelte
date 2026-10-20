<script lang="ts">
import {
  ANALYTICS_EVENT,
  type AnalyticsEventDetail,
  analyticsEventName,
  sanitizeAnalyticsParams,
} from '@core/module-kit/analytics';
import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';
import { page } from '$app/state';
import {
  ANALYTICS_EVENT_COOKIE,
  type AnalyticsConfig,
  areaOf,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE,
  isTracked,
  readCookie,
  trackedPath,
} from '$lib/analytics/core';
import { google } from '$lib/analytics/google';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/**
 * Visitor analytics for the whole app: the consent banner, page views on every navigation, the
 * core events (sign-in, sign-up, sign-out, table search) and the events modules send through
 * `track()` from `@core/module-kit/analytics`. JavaScript-only by design — without it there is
 * nothing to measure with — so the server renders nothing here.
 *
 * Nothing reaches the provider unless analytics is on, the page's area (public site / dashboard)
 * is tracked, and — when consent is required — the visitor accepted. The provider's script is not
 * even downloaded before that.
 */
let { config }: { config: AnalyticsConfig | null } = $props();

const t = useT();
const providers = { google } as const;
type Consent = 'granted' | 'denied' | null;

let consent = $state<Consent>(null);
let mounted = $state(false);
/** The last location reported, so a query-only change (search as you type) is not a page view. */
let lastLocation: string | null = null;
/** The last table search reported, as `path?q` — one event per distinct search, not per keystroke. */
let lastSearch: string | null = null;

const area = $derived(areaOf(page.route.id));
const allowed = $derived(!!config && (!config.requireConsent || consent === 'granted'));
const showBanner = $derived(
  mounted && !!config && config.requireConsent && consent === null && isTracked(config, area),
);

function readConsent(): Consent {
  const v = readCookie(document.cookie, CONSENT_COOKIE);
  return v === 'granted' || v === 'denied' ? v : null;
}

/** The provider, loaded, when something may be sent for the page `routeId` right now; else null. */
function ready(routeId: string | null) {
  if (!config || !allowed || !isTracked(config, areaOf(routeId))) return null;
  const provider = providers[config.provider];
  provider.load(config.id);
  return provider;
}

/** Same-origin referrers would carry dashboard ids; outside ones keep only origin + path. */
function externalReferrer(): string {
  try {
    const ref = new URL(document.referrer);
    return ref.origin === location.origin ? '' : `${ref.origin}${ref.pathname}`;
  } catch {
    return '';
  }
}

function report(url: URL, routeId: string | null) {
  const provider = ready(routeId);
  if (!provider) return;
  const path = trackedPath(routeId, url.pathname);
  const loc = `${url.origin}${path}`;
  if (loc !== lastLocation) {
    provider.pageView({
      location: loc,
      path,
      // A pattern stands in for the title wherever the path is one: titles can name records.
      title: path === url.pathname ? document.title : path,
      referrer: lastLocation ?? externalReferrer(),
    });
    lastLocation = loc;
  }
  // The data tables search through `?q=`. Only the fact that a search happened is reported,
  // never what was typed.
  const q = areaOf(routeId) === 'dashboard' ? (url.searchParams.get('q')?.trim() ?? '') : '';
  const key = q ? `${path}?${q}` : null;
  if (key && key !== lastSearch) provider.event('search', { page_path: path });
  lastSearch = key;
  // A sign-in or sign-up the server just completed, left behind as a one-shot cookie.
  const pending = readCookie(document.cookie, ANALYTICS_EVENT_COOKIE);
  if (pending) {
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in every browser we support
    document.cookie = `${ANALYTICS_EVENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    if (pending === 'login' || pending === 'sign_up') provider.event(pending, {});
  }
}

function answer(value: 'granted' | 'denied') {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in every browser we support
  document.cookie = `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure}`;
  consent = value;
  if (value === 'granted') report(page.url, page.route.id);
}

// `page`, not the navigation's `to`: on the first load of a document `to.route.id` arrives as null,
// which would pass a dashboard page off as a public one and report its raw path, ids included.
afterNavigate(() => {
  if (!mounted) consent = readConsent();
  report(page.url, page.route.id);
});

onMount(() => {
  consent = readConsent();
  mounted = true;
  const onTrack = (e: Event) => {
    const detail = (e as CustomEvent<AnalyticsEventDetail>).detail;
    const name = detail ? analyticsEventName(detail.name) : null;
    if (name) ready(page.route.id)?.event(name, sanitizeAnalyticsParams(detail.params));
  };
  // Sign-out is a plain form POST that ends the session, so it is reported on its way out.
  const onSubmit = (e: SubmitEvent) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (new URL(form.action, location.href).pathname !== '/auth/logout') return;
    ready(page.route.id)?.event('logout', {});
  };
  window.addEventListener(ANALYTICS_EVENT, onTrack);
  document.addEventListener('submit', onSubmit, true);
  return () => {
    window.removeEventListener(ANALYTICS_EVENT, onTrack);
    document.removeEventListener('submit', onSubmit, true);
  };
});
</script>

{#if showBanner}
  <div
    role="region"
    aria-labelledby="consent-title"
    data-testid="consent-banner"
    class="fixed inset-x-4 bottom-4 z-50 rounded-lg border bg-card p-4 text-card-foreground shadow-lg sm:inset-x-auto sm:start-4 sm:max-w-md print:hidden"
  >
    <p id="consent-title" class="font-semibold">{t('shell.consent_title')}</p>
    <p class="mt-1 text-sm text-muted-foreground">{t('shell.consent_message')}</p>
    <div class="mt-3 flex justify-end gap-2">
      <Button variant="outline" size="sm" onclick={() => answer('denied')} data-testid="consent-decline">{t('shell.consent_decline')}</Button>
      <Button size="sm" onclick={() => answer('granted')} data-testid="consent-accept">{t('shell.consent_accept')}</Button>
    </div>
  </div>
{/if}
