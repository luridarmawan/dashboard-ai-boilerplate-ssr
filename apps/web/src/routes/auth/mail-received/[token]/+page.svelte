<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { useT } from '$lib/i18n';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
const t = useT();
</script>

<svelte:head><title>{t('auth.mail_received.title')}</title></svelte:head>

<div class="page">
  <h1>{t('auth.mail_received.title')}</h1>
  {#if form?.confirmed}
    <p class="notice" data-testid="mail-received-done">{t('auth.mail_received.done')}</p>
  {:else if !data.valid}
    <p class="error">{t('auth.mail_received.invalid')}</p>
  {:else}
    {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
    <p>{t('auth.mail_received.body')}</p>
    <form method="POST" class="stack" data-testid="mail-received-form">
      <Csrf token={data.csrf} />
      <button type="submit">{t('auth.mail_received.confirm')}</button>
    </form>
  {/if}
</div>
