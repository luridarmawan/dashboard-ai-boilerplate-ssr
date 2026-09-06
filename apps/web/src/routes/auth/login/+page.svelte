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
  <form method="POST" class="stack">
    <Csrf token={data.csrf} />
    <input type="hidden" name="next" value={data.next} />
    <label>{t('auth.login.email')} <input name="email" type="email" required autocomplete="username" value={form?.values?.email ?? ''} /></label>
    <label>{t('auth.login.password')} <input name="password" type="password" required autocomplete="current-password" /></label>
    <div class="row">
      <button type="submit">{t('auth.login.submit')}</button>
      <a href="/auth/forgot">{t('auth.login.forgot')}</a>
      <a href="/auth/register">{t('auth.login.register')}</a>
    </div>
  </form>
</div>
