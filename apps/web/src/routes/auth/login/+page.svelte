<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { useT } from '$lib/i18n';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
const t = useT();
</script>

<svelte:head><title>{t('auth.login.title')}</title></svelte:head>

<div class="page">
  <h1>{t('auth.login.title')}</h1>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  {#if data.ssoError && !form?.mfa}<p class="error">{t('auth.google.failed')}</p>{/if}
  {#if form?.mfa}
    <!-- Second factor (A-11): password accepted, now a TOTP or recovery code; works without JavaScript. -->
    <form method="POST" class="stack" data-testid="mfa-form">
      <Csrf token={data.csrf} />
      <input type="hidden" name="challenge" value={form.mfa.challenge} />
      <input type="hidden" name="next" value={form.mfa.next || data.next} />
      <p>{t('auth.mfa.prompt')}</p>
      <label>{t('auth.mfa.code')} <input name="code" inputmode="numeric" autocomplete="one-time-code" required minlength="6" maxlength="20" /></label>
      <div class="row">
        <button type="submit">{t('auth.mfa.submit')}</button>
        <a href="/auth/login">{t('auth.mfa.back')}</a>
      </div>
      <p class="muted">{t('auth.mfa.recovery_hint')}</p>
    </form>
  {:else}
  <form method="POST" class="stack">
    <Csrf token={data.csrf} />
    <input type="hidden" name="next" value={data.next} />
    <label>{t('auth.login.email')} <input name="email" type="email" required autocomplete="username" value={form?.values?.email ?? ''} /></label>
    <label>{t('auth.login.password')} <input name="password" type="password" required autocomplete="current-password" /></label>
    <div class="row">
      <button type="submit">{t('auth.login.submit')}</button>
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
