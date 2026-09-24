<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { PasswordInput } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form: ActionData } = $props();
const t = useT();
</script>

<svelte:head><title>{t('auth.reset.title')}</title></svelte:head>

<div class="page">
  <h1>{t('auth.reset.title')}</h1>
  {#if !data.valid}
    <p class="error">{t('auth.reset.invalid')} <a href="/auth/forgot">{t('auth.reset.request_new')}</a>.</p>
  {:else}
    {#if form?.error}
      <p class="error">{form.error}{#if Array.isArray(form.details)} — {form.details.join(', ')}{/if}</p>
    {/if}
    <form method="POST" class="stack" data-testid="reset-form">
      <Csrf token={data.csrf} />
      <input type="hidden" name="token" value={data.token} />
      <!-- `<label for>` + <PasswordInput plain>: same shape as the login and join pages, see there. -->
      <div class="grid gap-1 text-sm">
        <label for="reset-password">{t('auth.reset.new_password')}</label>
        <PasswordInput plain id="reset-password" name="password" required minlength={12} autocomplete="new-password" />
        <span class="muted">{t('auth.register.password_hint')}</span>
      </div>
      <div class="grid gap-1 text-sm">
        <label for="reset-password-confirm">{t('auth.reset.confirm')}</label>
        <PasswordInput
          plain
          id="reset-password-confirm"
          name="password_confirm"
          required
          minlength={12}
          autocomplete="new-password"
          aria-invalid={form?.code === 'password_mismatch' ? 'true' : undefined}
        />
      </div>
      <button type="submit">{t('common.save')}</button>
    </form>
  {/if}
</div>
