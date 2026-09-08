<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { useT } from '$lib/i18n';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
const t = useT();
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
      {:else if data.error === 'api' && data.message}{data.message}
      {:else}{t('auth.google.failed')}{/if}
    </p>
    <div class="row">
      <a class="btn" href="/auth/google">{t('auth.google.retry')}</a>
      <a href="/auth/login">{t('auth.mfa.back')}</a>
    </div>
  {/if}
</div>
