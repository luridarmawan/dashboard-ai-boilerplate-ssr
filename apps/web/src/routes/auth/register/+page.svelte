<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { useT } from '$lib/i18n';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
const t = useT();
</script>

<svelte:head><title>{t('auth.register.title')}</title></svelte:head>

<div class="page">
  <h1>{t('auth.register.title')}</h1>
  {#if data.signupEnabled === false}
    <p class="error">Pendaftaran mandiri dimatikan oleh administrator.</p>
  {:else}
  {#if form?.error}
    <p class="error">{form.error}{#if Array.isArray(form.details)} — {form.details.join(', ')}{/if}</p>
  {/if}
  <form method="POST" class="stack">
    <Csrf token={data.csrf} />
    <label>{t('auth.register.name')} <input name="name" required maxlength="191" value={form?.values?.name ?? ''} /></label>
    <label>{t('auth.login.email')} <input name="email" type="email" required autocomplete="username" value={form?.values?.email ?? ''} /></label>
    <label>{t('auth.login.password')} <input name="password" type="password" required minlength="12" autocomplete="new-password" /><span class="muted">{t('auth.register.password_hint')}</span></label>
    <div class="row"><button type="submit">{t('auth.register.submit')}</button><a href="/auth/login">{t('auth.register.have_account')}</a></div>
  </form>
  {/if}
</div>
