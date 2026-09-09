<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { useT } from '$lib/i18n';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
const t = useT();
</script>

<svelte:head><title>{t('join.title')}</title></svelte:head>

<div class="page">
  <h1>{t('join.title')}</h1>
  {#if data.invitation}
    <p class="muted">{t('join.lead', { tenant: data.invitation.tenant.name })}</p>
    {#if form?.error}
      <p class="error">{form.error}{#if Array.isArray(form.details)} — {form.details.join(', ')}{/if}</p>
    {/if}
    <form method="POST" class="stack" data-testid="join-form">
      <Csrf token={data.csrf} />
      <label>{t('join.email')} <input type="email" value={data.invitation.email} readonly /></label>
      <label>{t('join.name')} <input name="name" required maxlength="191" autocomplete="name" value={form?.values?.name ?? ''} /></label>
      <label>{t('join.password')} <input name="password" type="password" required minlength="12" autocomplete="new-password" /><span class="muted">{t('auth.register.password_hint')}</span></label>
      <div class="row"><button type="submit">{t('join.submit')}</button><a href="/auth/login">{t('join.have_account')}</a></div>
    </form>
  {:else}
    <p class="error" role="alert">{data.problem === 'token_expired' ? t('join.expired') : t('join.invalid')}</p>
    <p class="muted">{t('join.ask_again')}</p>
    <div class="row"><a class="btn" href="/auth/login">{t('nav.login')}</a></div>
  {/if}
</div>
