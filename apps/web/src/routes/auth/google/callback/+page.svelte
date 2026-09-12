<script lang="ts">
import type { MessageKey } from '@core/i18n';
import Csrf from '$lib/components/Csrf.svelte';
import { useT } from '$lib/i18n';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
const t = useT();

/**
 * The API speaks one language; the page speaks the user's (K-4). Every refusal this endpoint can
 * hand back is keyed on its `reason` (or, where it has none, its error code); anything unmapped
 * falls through to the generic failure message rather than the API's own wording.
 */
const BY_REASON: Record<string, MessageKey> = {
  email_unverified: 'auth.google.err.email_unverified',
  domain: 'auth.google.err.domain',
  not_registered: 'auth.google.err.not_registered',
  inactive: 'auth.google.err.inactive',
};
const BY_CODE: Record<string, MessageKey> = {
  sso_disabled: 'auth.google.err.disabled',
  rate_limited: 'auth.google.err.rate_limited',
};
const apiMessage = $derived.by(() => {
  if (data.error !== 'api') return null;
  const key = (data.reason ? BY_REASON[data.reason] : undefined) ?? BY_CODE[data.code ?? ''];
  return key ? t(key) : t('auth.google.failed');
});
</script>

<svelte:head><title>{t('auth.google.title')}</title></svelte:head>

<div class="page">
  <h1>{t('auth.google.title')}</h1>
  {#if data.mfa}
    <!-- Google vouched for the user; the second factor (A-11) is still theirs to give. Same form as the login page's step two. -->
    <form method="POST" action="/auth/login" class="stack" data-testid="mfa-form">
      <Csrf token={data.csrf} />
      <input type="hidden" name="challenge" value={data.mfa.challenge} />
      <input type="hidden" name="next" value={data.mfa.next} />
      <p>{t('auth.google.mfa_prompt')}</p>
      <label>{t('auth.mfa.code')} <input name="code" inputmode="numeric" autocomplete="one-time-code" required minlength="6" maxlength="20" /></label>
      <div class="row">
        <button type="submit">{t('auth.mfa.submit')}</button>
        <a href="/auth/login">{t('auth.mfa.back')}</a>
      </div>
      <p class="muted">{t('auth.mfa.recovery_hint')}</p>
    </form>
  {:else}
    <p class="error">
      {#if data.error === 'cancelled'}{t('auth.google.cancelled')}
      {:else if apiMessage}{apiMessage}
      {:else}{t('auth.google.failed')}{/if}
    </p>
    <div class="row">
      <a class="btn" href="/auth/google">{t('auth.google.retry')}</a>
      <a href="/auth/login">{t('auth.mfa.back')}</a>
    </div>
  {/if}
</div>
