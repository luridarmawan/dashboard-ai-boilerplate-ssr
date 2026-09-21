<script lang="ts">
import { enhance } from '$app/forms';
import Csrf from '$lib/components/Csrf.svelte';
import { type FieldDef, FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import Presence from '$lib/components/Presence.svelte';
import { Alert, Badge, Button, Card, Field, Input } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import { presenceText } from '$lib/presence';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const dateLocale = useLocale() === 'en' ? 'en-US' : 'id-ID';
const can = (p: string) => data.viewer.isSuperadmin || hasPermission(data.permissions, p);
const u = $derived(data.user);
const editable = $derived(can('user.edit'));
const fields: FieldDef[] = $derived([
  { name: 'name', type: 'string', label: t('users.name'), required: true, maxlength: 191 },
  {
    name: 'phone',
    type: 'string',
    label: t('users.phone'),
    maxlength: 32,
    hint: t('profile.phone_hint'),
  },
  {
    name: 'locale',
    type: 'select',
    label: t('nav.language'),
    options: [
      { value: 'id', label: t('lang.id') },
      { value: 'en', label: t('lang.en') },
    ],
  },
  { name: 'active', type: 'boolean', label: t('users.detail.active') },
  ...(data.viewer.isSuperadmin
    ? [
        {
          name: 'isSuperadmin',
          type: 'boolean',
          label: t('users.detail.superadmin_label'),
        } as FieldDef,
      ]
    : []),
  {
    name: 'groupIds',
    type: 'multiselect',
    label: t('users.detail.groups_here'),
    span: 2,
    options: data.groups.map((g) => ({ value: g.id, label: g.name })),
  },
]);
const values = $derived({
  name: u.name,
  phone: u.phone,
  locale: u.locale,
  active: u.statusId === 1,
  isSuperadmin: u.isSuperadmin,
  groupIds: u.groups.map((g) => g.id),
});
/** Open on `?confirm=delete`, and stay open when the action bounced the typed e-mail back. */
const confirming = $derived(data.confirmDelete || form?.code === 'confirm_failed');
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
/** Which form a bounced action belongs to: the password card's failures must not land on the profile form. */
const scope = $derived((form as { scope?: string } | null)?.scope);
/**
 * Setting someone's password or mailing them a reset link is an edit of that user — except one's
 * own, which the profile page handles with the current password first; a superadmin's only by a
 * superadmin (mirrors the API); and never while impersonating, since credential changes are refused
 * meanwhile (D-6).
 */
const canPassword = $derived(
  can('user.edit') &&
    !data.impersonator &&
    u.id !== data.viewer.id &&
    (!u.isSuperadmin || data.viewer.isSuperadmin),
);
const passwordFields: FieldDef[] = $derived([
  {
    name: 'newPassword',
    type: 'password',
    label: t('auth.reset.new_password'),
    required: true,
    minlength: 10,
    maxlength: 256,
    autocomplete: 'new-password',
    hint: t('users.detail.password.weak'),
  },
  {
    name: 'confirm',
    type: 'password',
    label: t('profile.password.confirm'),
    required: true,
    minlength: 10,
    maxlength: 256,
    autocomplete: 'new-password',
  },
]);
</script>

<svelte:head><title>{u.name}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3">
    <h1>{u.name}</h1>
    <span class="text-muted-foreground">{u.email}</span>
    {#if u.isSuperadmin}<Badge variant="outline">superadmin</Badge>{/if}
    <Badge variant={u.statusId === 1 ? 'success' : 'secondary'}>{u.statusId === 1 ? t('common.active') : t('common.inactive')}</Badge>
    <!-- D-5: "is this account enabled" and "is this person here" are different questions. -->
    <Presence online={u.online} text={presenceText(u, dateLocale, t)} label />
  </div>
  {#if data.created}<p class="notice">{t('users.detail.created')}</p>{/if}
  {#if can('user.impersonate') && !data.impersonator && !u.isSuperadmin && u.id !== data.viewer.id && u.statusId === 1}
    <!-- Impersonation (D-6): one click, then the banner on every page and a way back. -->
    <form method="POST" action="?/impersonate" class="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm" data-testid="impersonate-form">
      <Csrf token={data.csrf} />
      <Icon name="eye" size={16} />
      <span>{t('users.detail.impersonate_hint')}</span>
      <Button type="submit" variant="outline" size="sm">{t('users.detail.impersonate', { name: u.name })}</Button>
    </form>
  {/if}

  <Card>
    <FormBuilder
      {fields}
      {values}
      errors={fieldErrors}
      csrf={data.csrf}
      action="?/save"
      columns={2}
      readonly={!editable}
      cancelHref="/users"
      cancelLabel={t('common.back')}
      notice={form?.saved ? t('common.saved') : null}
      error={form?.error && !scope && Object.keys(fieldErrors).length === 0 ? form.error : null}
    />
    <p class="mt-4 text-sm text-muted-foreground">{t('users.detail.meta', { created: new Date(u.createdAt).toLocaleString(dateLocale), lastLogin: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString(dateLocale) : '—' })}</p>
  </Card>

  {#if canPassword}
    <Card title={t('users.detail.password.title')} description={t('users.detail.password.desc')}>
      <div class="grid gap-6 lg:grid-cols-2" data-testid="password-card">
        <!-- Set it here: same rules as the profile page minus the current password (the admin has none to give). -->
        <FormBuilder
          fields={passwordFields}
          errors={scope === 'password' ? fieldErrors : {}}
          csrf={data.csrf}
          action="?/password"
          ajax
          class="[&_button]:cursor-pointer"
          submitLabel={t('users.detail.password.submit')}
          notice={form?.passwordChanged ? t('users.detail.password.changed') : null}
          error={scope === 'password' && Object.keys(fieldErrors).length === 0 ? (form?.error ?? null) : null}
        />
        <!-- Or let the person set it themselves: one click mails the link the forgot-password page would. -->
        <form method="POST" action="?/resetLink" class="flex flex-col gap-3 rounded-md border p-4 text-sm" data-testid="reset-link-form" use:enhance>
          <Csrf token={data.csrf} />
          <div class="flex items-start gap-2">
            <Icon name="mail" size={16} class="mt-0.5 shrink-0" />
            <p>{t('users.detail.password.link_hint', { email: u.email })}</p>
          </div>
          {#if form?.linkSent}<p class="notice" role="status">{t('users.detail.password.link_sent', { email: u.email })}</p>{/if}
          {#if scope === 'resetLink' && form?.error}<p class="error" role="alert">{form.error}</p>{/if}
          {#if data.resetLinkDeliverable}
            <div><Button type="submit" variant="outline">{t('users.detail.password.link_send')}</Button></div>
          {:else}
            <!-- `.test` / `.invalid` never receive mail (RFC 2606): say so instead of offering a click that bounces. -->
            <p class="text-muted-foreground" data-testid="reset-link-undeliverable">{t('users.detail.password.link_undeliverable', { email: u.email })}</p>
          {/if}
        </form>
      </div>
    </Card>
  {/if}

  {#if can('user.manage')}
    <Card title={t('users.detail.remove_title')} description={t('users.detail.remove_desc')}>
      {#if confirming}
        <!-- Two-step confirmation (no JavaScript required): the e-mail has to be typed, and the action checks it again. -->
        <div class="grid gap-4" id="delete">
          <Alert variant="error" title={t('users.detail.delete_confirm')}>
            <p>{t('users.detail.delete_confirm_lead', { name: u.name, email: u.email })}</p>
          </Alert>
          <form method="POST" action="?/delete&confirm=delete" class="grid gap-4">
            <Csrf token={data.csrf} />
            <Field label={t('users.detail.delete_confirm_email', { email: u.email })} for="confirm-email" error={form?.code === 'confirm_failed' ? form.error : null} required>
              <Input id="confirm-email" name="email" autocomplete="off" autocapitalize="none" spellcheck={false} required />
            </Field>
            <div class="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive"><Icon name="trash" size={16} />{t('users.detail.delete_confirm_submit')}</Button>
              <Button href="/users/{u.id}" variant="secondary">{t('common.cancel')}</Button>
            </div>
          </form>
        </div>
      {:else}
        <Button href="/users/{u.id}?confirm=delete#delete" variant="destructive"><Icon name="trash" size={16} />{t('users.detail.remove_button')}</Button>
      {/if}
    </Card>
  {/if}
</div>
