<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { type FieldDef, FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, Table } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const dateLocale = useLocale() === 'en' ? 'en-US' : 'id-ID';
const profileFields: FieldDef[] = $derived([
  { name: 'name', type: 'string', label: t('profile.name'), required: true, maxlength: 191 },
  {
    name: 'locale',
    type: 'select',
    label: t('nav.language'),
    required: true,
    options: [
      { value: 'id', label: t('lang.id') },
      { value: 'en', label: t('lang.en') },
    ],
  },
  {
    name: 'theme',
    type: 'select',
    label: t('theme.theme'),
    options: data.themes.map((th) => ({ value: th.id, label: th.name })),
    hint: t('profile.theme_hint'),
  },
  {
    name: 'avatarUrl',
    type: 'string',
    label: t('profile.avatar_url'),
    maxlength: 512,
    hint: t('profile.avatar_url_hint'),
  },
]);
const initials = $derived(
  data.user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('') || '?',
);
const passwordFields: FieldDef[] = [
  {
    name: 'currentPassword',
    type: 'password',
    label: t('profile.password.current'),
    required: true,
    autocomplete: 'current-password',
  },
  {
    name: 'newPassword',
    type: 'password',
    label: t('auth.reset.new_password'),
    required: true,
    minlength: 12,
    autocomplete: 'new-password',
  },
  {
    name: 'confirm',
    type: 'password',
    label: t('profile.password.confirm'),
    required: true,
    minlength: 12,
    autocomplete: 'new-password',
  },
];
const tokenFields: FieldDef[] = [
  {
    name: 'name',
    type: 'string',
    label: t('profile.tokens.name'),
    required: true,
    maxlength: 100,
    placeholder: t('profile.tokens.name_placeholder'),
  },
  {
    name: 'expiresInDays',
    type: 'select',
    label: t('profile.tokens.expires'),
    options: [
      { value: '30', label: t('profile.tokens.days_30') },
      { value: '90', label: t('profile.tokens.days_90') },
      { value: '365', label: t('profile.tokens.year_1') },
      { value: '', label: t('profile.tokens.no_expiry') },
    ],
  },
  {
    name: 'scopes',
    type: 'text',
    label: t('profile.tokens.scopes'),
    rows: 2,
    hint: t('profile.tokens.scopes_hint'),
  },
];
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale) : '—');
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
const apiError = $derived(form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null);
// Failure of the "enable 2FA" step: shown next to the QR instead of the generic slot.
const mfaError = $derived(
  (form as { mfaStage?: string; error?: string } | null)?.mfaStage === 'enable'
    ? ((form as { error?: string } | null)?.error ?? null)
    : null,
);
</script>

<svelte:head><title>{t('nav.profile')}</title></svelte:head>

<div class="page">
  <h1>{t('profile.title')}</h1>
  <Card title={t('profile.avatar.title')} description={t('profile.avatar.desc')}>
    <div class="flex flex-wrap items-center gap-4" data-testid="avatar-card">
      {#if data.user.avatarUrl}
        <img src={data.user.avatarUrl} alt="" class="h-16 w-16 rounded-full border object-cover" />
      {:else}
        <span class="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">{initials}</span>
      {/if}
      <form method="POST" action="?/avatar" enctype="multipart/form-data" class="flex flex-wrap items-center gap-2">
        <Csrf token={data.csrf} />
        <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif" required class="text-sm" />
        <Button type="submit" size="sm"><Icon name="upload" size={14} />{t('profile.avatar.upload')}</Button>
      </form>
      {#if data.user.avatarUrl}
        <form method="POST" action="?/avatarRemove"><Csrf token={data.csrf} /><Button type="submit" variant="ghost" size="sm" class="text-destructive"><Icon name="trash" size={14} />{t('profile.avatar.remove')}</Button></form>
      {/if}
    </div>
    {#if form?.saved === 'avatar'}<p class="notice mt-3">{t('profile.avatar.saved')}</p>{/if}
    {#if form?.saved === undefined && fieldErrors.avatar}<p class="error mt-3" role="alert">{fieldErrors.avatar}</p>{/if}
    {#if form?.saved === undefined && fieldErrors.file}<p class="error mt-3" role="alert">{fieldErrors.file}</p>{/if}
  </Card>
  <Card title={t('profile.basics.title')} description={data.user.email}>
    <FormBuilder
      fields={profileFields}
      values={{ name: data.user.name, locale: data.user.locale, theme: data.user.theme ?? '', avatarUrl: data.user.avatarUrl ?? '' }}
      errors={form?.saved === 'password' ? {} : fieldErrors}
      csrf={data.csrf}
      action="?/profile"
      columns={2}
      notice={form?.saved === 'profile' ? t('profile.saved') : null}
      error={form?.saved === undefined ? apiError : null}
    />
    <p class="mt-3 text-sm text-muted-foreground"><a href="/theme?back=/profile">{t('theme.title')}</a> · <a href="/lang?back=/profile">{t('nav.language')}</a></p>
  </Card>
  <Card title={t('profile.mfa.title')} description={t('profile.mfa.desc')}>
    <div data-testid="mfa-card">
      {#if form?.saved === 'mfaEnabled' || form?.saved === 'mfaCodes'}
        <div class="notice" role="status" data-testid="recovery-codes">
          <p class="font-medium">{form.saved === 'mfaEnabled' ? t('profile.mfa.enabled_notice') : t('profile.mfa.codes_replaced')} {t('profile.mfa.save_codes')}</p>
          <ul class="mt-2 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">{#each form.recoveryCodes ?? [] as c (c)}<li><code class="select-all">{c}</code></li>{/each}</ul>
        </div>
      {:else if data.mfa.pending}
        <div class="grid gap-3 sm:grid-cols-[200px_1fr]" data-testid="mfa-setup">
          {#if data.mfa.qr}<div class="rounded-md border bg-white p-2">{@html data.mfa.qr}</div>{/if}
          <div class="grid gap-2 text-sm">
            <p>{t('profile.mfa.scan')}</p>
            <code class="select-all break-all rounded-md border bg-background px-2 py-1">{data.mfa.secret}</code>
            <form method="POST" action="?/mfaEnable" class="flex flex-wrap items-end gap-2">
              <Csrf token={data.csrf} />
              <label class="grid gap-1"><span>{t('profile.mfa.code_label')}</span><input name="code" inputmode="numeric" autocomplete="one-time-code" required minlength="6" maxlength="8" class="h-9 w-36 rounded-md border border-input bg-background px-2" /></label>
              <Button type="submit" size="sm">{t('profile.mfa.enable')}</Button>
            </form>
            {#if mfaError}<p class="error" role="alert">{mfaError}</p>{/if}
            <form method="POST" action="?/mfaSetup" class="text-xs text-muted-foreground"><Csrf token={data.csrf} />{t('profile.mfa.not_scanned')} <button type="submit" class="underline">{t('profile.mfa.restart')}</button></form>
          </div>
        </div>
      {:else if data.mfa.enabled}
        <p class="text-sm"><Badge variant="success">{t('common.active')}</Badge> · {t('profile.mfa.codes_left', { n: data.mfa.recoveryCodesLeft })}</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <form method="POST" action="?/mfaCodes" class="flex flex-wrap items-end gap-2">
            <Csrf token={data.csrf} />
            <label class="grid gap-1 text-sm"><span>{t('profile.mfa.current_code')}</span><input name="code" inputmode="numeric" autocomplete="one-time-code" required minlength="6" maxlength="8" class="h-9 w-36 rounded-md border border-input bg-background px-2" /></label>
            <Button type="submit" variant="outline" size="sm">{t('profile.mfa.new_codes')}</Button>
          </form>
          <form method="POST" action="?/mfaDisable" class="flex flex-wrap items-end gap-2">
            <Csrf token={data.csrf} />
            <label class="grid gap-1 text-sm"><span>{t('profile.password.current')}</span><input name="password" type="password" autocomplete="current-password" required class="h-9 w-44 rounded-md border border-input bg-background px-2" /></label>
            <Button type="submit" variant="destructive" size="sm">{t('profile.mfa.disable')}</Button>
          </form>
        </div>
        {#if form?.saved === undefined && form?.error && !mfaError}<p class="error mt-2" role="alert">{form.error}</p>{/if}
      {:else}
        <p class="text-sm text-muted-foreground">{t('profile.mfa.off')}</p>
        <form method="POST" action="?/mfaSetup" class="mt-3"><Csrf token={data.csrf} /><Button type="submit" size="sm"><Icon name="shield" size={14} />{t('profile.mfa.setup')}</Button></form>
      {/if}
      {#if form?.saved === 'mfaDisabled'}<p class="notice mt-3">{t('profile.mfa.disabled_notice')}</p>{/if}
    </div>
  </Card>
  <Card title={t('profile.password.title')} description={t('profile.password.desc')}>
    <FormBuilder fields={passwordFields} errors={form?.saved === undefined && form?.code ? {} : fieldErrors} csrf={data.csrf} action="?/password" submitLabel={t('profile.password.title')} notice={form?.saved === 'password' ? t('profile.password.changed') : null} error={null} />
  </Card>
  {#if data.canTokens}
  <!-- MCP integration (I-4): only for someone allowed to use MCP tools; the actions check it too. -->
  <Card title={t('profile.tokens.title')} description={t('profile.tokens.desc')}>
    {#if form?.saved === 'token' && form.token}
      <div class="notice mb-4" role="status" data-testid="new-token">
        <p class="font-medium">{t('profile.tokens.created', { name: form.tokenName ?? '' })}</p>
        <code class="mt-2 block select-all break-all rounded-md border bg-background px-3 py-2 text-sm">{form.token}</code>
        <p class="mt-2 text-sm text-muted-foreground">{t('profile.tokens.example')} <code>claude mcp add --transport http dashboard {data.appOrigin ?? ''}/v1/mcp --header "Authorization: Bearer …"</code></p>
      </div>
    {/if}
    {#if form?.saved === 'revoke'}<p class="notice mb-4">{t('profile.tokens.revoked')}</p>{/if}
    {#if data.tokens.length}
      <Table caption={t('profile.tokens.caption')}>
        <thead><tr><th>{t('profile.name')}</th><th>{t('profile.tokens.scopes_col')}</th><th>{t('profile.tokens.expires_col')}</th><th>{t('profile.tokens.last_used')}</th><th></th></tr></thead>
        <tbody>
          {#each data.tokens as tk (tk.id)}
            <tr data-testid="token-row">
              <td class="font-medium">{tk.name}</td>
              <td>{#if tk.scopes?.length}{#each tk.scopes as s (s)}<Badge variant="outline">{s}</Badge> {/each}{:else}<span class="text-muted-foreground">{t('profile.tokens.all_scopes')}</span>{/if}</td>
              <td>{tk.expiresAt ? fmt(tk.expiresAt) : t('profile.tokens.no_expiry_cell')}</td>
              <td>{fmt(tk.lastUsedAt)}</td>
              <td class="text-end">
                <form method="POST" action="?/revokeToken"><Csrf token={data.csrf} /><input type="hidden" name="id" value={tk.id} /><Button type="submit" variant="ghost" size="sm" class="text-destructive"><Icon name="trash" size={14} />{t('profile.tokens.revoke')}</Button></form>
              </td>
            </tr>
          {/each}
        </tbody>
      </Table>
    {:else}
      <p class="mb-3 text-sm text-muted-foreground">{t('profile.tokens.empty')}</p>
    {/if}
    <div class="mt-4">
      <FormBuilder fields={tokenFields} values={{ expiresInDays: '90' }} errors={form?.code === 'validation_failed' && form?.saved === undefined ? fieldErrors : {}} csrf={data.csrf} action="?/createToken" submitLabel={t('profile.tokens.create')} columns={2} notice={null} error={form?.saved === undefined && form?.values && 'name' in (form.values as object) ? apiError : null} />
    </div>
  </Card>
  {/if}
</div>
