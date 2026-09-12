<script lang="ts">
import type { MessageKey } from '@core/i18n';
import { tick, untrack } from 'svelte';
import { goto } from '$app/navigation';
import Csrf from '$lib/components/Csrf.svelte';
import { useT } from '$lib/i18n';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
const t = useT();

/**
 * Two layers (L-20 over L-22).
 *
 * The BASE is the plain form: it posts to this page's action, which calls the API server-side and
 * re-renders — login works with JavaScript off, which is what the HTTP proofs exercise.
 *
 * The ENHANCED layer sends the very same two steps over fetch to the API itself — POST
 * /v1/auth/login, then /v1/auth/login/mfa — with no page reload in between. `/v1` is same-origin
 * in every deployment (Caddy and the nginx/Apache examples route it to the API, Vite proxies it in
 * development, Decision E), so the API sets the session cookie on this browser directly: there is
 * nothing for the web server to forward. CSRF is the same double-submit pair the action uses —
 * the `crk_csrf` cookie rides along automatically and its token goes up in `x-csrf-token`.
 *
 * Nothing here invents behaviour the base lacks. If the API cannot be reached — or something that
 * is not the API answers — the submit is handed straight back to the browser and the base layer
 * runs, unchanged.
 */

type Envelope =
  | { success: true; data: { mfaRequired?: true; challenge?: string } }
  | { success: false; error: { code: string; message: string; details?: { reason?: string } } };

/** The API speaks one language; the page speaks the user's (K-4). Unmapped refusals fall through. */
const BY_CODE: Record<string, MessageKey> = {
  invalid_credentials: 'auth.login.err.invalid_credentials',
  rate_limited: 'auth.login.err.rate_limited',
  csrf_failed: 'auth.login.err.expired',
  validation_failed: 'auth.login.err.validation',
};
const BY_REASON: Record<string, MessageKey> = {
  bad_code: 'auth.mfa.err.bad_code',
  challenge_invalid: 'auth.mfa.err.challenge_invalid',
  too_many_attempts: 'auth.mfa.err.too_many_attempts',
};

/**
 * Bound, not a `value={…}` attribute: the action seeds the field (so the no-JS path still hands
 * back what was typed), but a plain expression is re-applied on every later re-render of this
 * page — the busy flag, the step-two switch — and would wipe what the visitor is typing.
 * `untrack` keeps that seeding a one-off read rather than a subscription to `form`.
 */
let email = $state(
  untrack(() => String((form?.values as { email?: string } | undefined)?.email ?? '')),
);
let busy = $state(false);
/**
 * Flipped on mount, so it is only ever true where the fetch layer actually runs. It marks the
 * form in the DOM — a click that lands before hydration posts the form the ordinary way, and
 * this is what says which of the two layers answered.
 */
let enhanced = $state(false);
$effect(() => {
  enhanced = true;
});
/** Set once the fetch layer has answered a submit; from then on it owns what the page says. */
let handled = $state(false);
let ajaxError = $state<string | null>(null);
/** Step two as the fetch layer knows it; without JavaScript the action supplies its own copy. */
let challenge = $state<string | null>(null);
let codeInput = $state<HTMLInputElement | null>(null);

const step2 = $derived(
  handled ? (challenge ? { challenge, next: data.next } : null) : (form?.mfa ?? null),
);
const errorText = $derived(handled ? ajaxError : (form?.error ?? null));

function messageFor(e: { code: string; details?: { reason?: string } }): string {
  const key = (e.details?.reason ? BY_REASON[e.details.reason] : undefined) ?? BY_CODE[e.code];
  return t(key ?? 'auth.login.err.failed');
}

/** One API call; `null` means nothing usable answered, which is the cue to fall back. */
async function post(path: string, body: unknown): Promise<Envelope | null> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-csrf-token': data.csrf,
      },
      body: JSON.stringify(body),
    });
    if (!res.headers.get('content-type')?.includes('application/json')) return null;
    const envelope = (await res.json()) as Envelope | null;
    return envelope && 'success' in envelope ? envelope : null;
  } catch {
    return null;
  }
}

/** The cookie is already on the browser; `invalidateAll` makes every load re-read it. */
async function enter() {
  try {
    await goto(data.next, { invalidateAll: true });
  } catch {
    window.location.assign(data.next);
  }
}

/** Step one (A-2, A-3): password. */
async function submitPassword(event: SubmitEvent) {
  event.preventDefault();
  const el = event.currentTarget as HTMLFormElement;
  const fields = new FormData(el);
  busy = true;
  handled = true;
  ajaxError = null;
  const envelope = await post('/v1/auth/login', {
    email,
    password: String(fields.get('password') ?? ''),
  });
  busy = false;
  // Nothing usable answered: hand the submit back to the browser, which posts to this page's
  // action exactly as it would with JavaScript off.
  if (!envelope) {
    el.submit();
    return;
  }
  if (!envelope.success) {
    ajaxError = messageFor(envelope.error);
    return;
  }
  // Second factor (A-11): the same form step the action renders, without leaving the page.
  if (envelope.data.mfaRequired && envelope.data.challenge) {
    challenge = envelope.data.challenge;
    await tick();
    codeInput?.focus();
    return;
  }
  await enter();
}

/** Step two (A-11): TOTP or recovery code against the challenge from step one. */
async function submitCode(event: SubmitEvent) {
  event.preventDefault();
  const el = event.currentTarget as HTMLFormElement;
  const fields = new FormData(el);
  busy = true;
  handled = true;
  ajaxError = null;
  const envelope = await post('/v1/auth/login/mfa', {
    challenge: String(fields.get('challenge') ?? ''),
    code: String(fields.get('code') ?? ''),
  });
  busy = false;
  // Nothing usable answered: hand the submit back to the browser, which posts to this page's
  // action exactly as it would with JavaScript off.
  if (!envelope) {
    el.submit();
    return;
  }
  if (!envelope.success) {
    ajaxError = messageFor(envelope.error);
    // A wrong code keeps the same challenge (attempts are counted server-side); an expired or
    // exhausted one sends the user back to the password form.
    if (envelope.error.details?.reason !== 'bad_code') challenge = null;
    return;
  }
  await enter();
}
</script>

<svelte:head><title>{t('auth.login.title')}</title></svelte:head>

<div class="page">
  <h1>{t('auth.login.title')}</h1>
  {#if errorText}<p class="error" role="alert">{errorText}</p>{/if}
  {#if data.ssoError && !step2 && !errorText}<p class="error" role="alert">{t('auth.google.failed')}</p>{/if}
  {#if step2}
    <!-- Second factor (A-11): password accepted, now a TOTP or recovery code; works without JavaScript. -->
    <form method="POST" class="stack" data-testid="mfa-form" data-enhanced={enhanced ? 'true' : null} onsubmit={submitCode}>
      <Csrf token={data.csrf} />
      <input type="hidden" name="challenge" value={step2.challenge} />
      <input type="hidden" name="next" value={step2.next || data.next} />
      <p>{t('auth.mfa.prompt')}</p>
      <label>{t('auth.mfa.code')} <input name="code" bind:this={codeInput} inputmode="numeric" autocomplete="one-time-code" required minlength="6" maxlength="20" /></label>
      <div class="row">
        <button type="submit" disabled={busy} aria-busy={busy}>{busy ? t('auth.login.submitting') : t('auth.mfa.submit')}</button>
        <a href="/auth/login">{t('auth.mfa.back')}</a>
      </div>
      <p class="muted">{t('auth.mfa.recovery_hint')}</p>
    </form>
  {:else}
  <form method="POST" class="stack" data-testid="login-form" data-enhanced={enhanced ? 'true' : null} onsubmit={submitPassword}>
    <Csrf token={data.csrf} />
    <input type="hidden" name="next" value={data.next} />
    <label>{t('auth.login.email')} <input name="email" type="email" required autocomplete="username" bind:value={email} /></label>
    <label>{t('auth.login.password')} <input name="password" type="password" required autocomplete="current-password" /></label>
    <div class="row">
      <button type="submit" disabled={busy} aria-busy={busy}>{busy ? t('auth.login.submitting') : t('auth.login.submit')}</button>
      <a href="/auth/forgot">{t('auth.login.forgot')}</a>
      {#if data.signupEnabled}<a href="/auth/register">{t('auth.login.register')}</a>{/if}
    </div>
  </form>
  {#if data.google}
    <!-- Sign in with Google (A-8): a plain link — the redirect dance is server-side, no JavaScript. -->
    <p class="muted sso-or">{t('auth.login.or')}</p>
    <a class="btn secondary" href={`/auth/google?next=${encodeURIComponent(data.next)}`} data-testid="google-login">{t('auth.login.google')}</a>
  {/if}
  {/if}
</div>
