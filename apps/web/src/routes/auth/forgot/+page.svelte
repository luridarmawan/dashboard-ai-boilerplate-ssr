<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { useT } from '$lib/i18n';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
const t = useT();
</script>

<svelte:head><title>{t('auth.forgot.title')}</title></svelte:head>

<div class="page">
  <h1>{t('auth.forgot.title')}</h1>
  {#if form?.sent}
    <p class="notice">{t('auth.forgot.sent')}</p>
  {:else}
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    <form method="POST" class="stack">
      <Csrf token={data.csrf} />
      <label>{t('auth.login.email')} <input name="email" type="email" required value={form?.values?.email ?? ''} /></label>
      <div class="row"><button type="submit">{t('auth.forgot.submit')}</button><a href="/auth/login">{t('common.back')}</a></div>
    </form>
  {/if}
</div>
