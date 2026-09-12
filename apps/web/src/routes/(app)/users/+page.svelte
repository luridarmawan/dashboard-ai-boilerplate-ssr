<script lang="ts">
import { page } from '$app/state';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { type ColumnDef, DataTable, type RowAction } from '$lib/components/table';
import { Badge, Button, Card } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const dateLocale = useLocale() === 'en' ? 'en-US' : 'id-ID';
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
type Row = (typeof data.users)[number];

const columns: ColumnDef<Row>[] = [
  { key: 'name', label: t('users.name'), sortKey: 'name', value: (r) => r.name },
  { key: 'email', label: t('users.email'), sortKey: 'email', value: (r) => r.email },
  { key: 'phone', label: t('users.phone'), value: (r) => r.phone || '—' },
  {
    key: 'groups',
    label: t('users.groups'),
    value: (r) => r.groups.map((g) => g.name).join(', ') || '—',
  },
  { key: 'status', label: t('users.status') },
  {
    key: 'lastLogin',
    label: t('users.last_login'),
    sortKey: 'last_login_at',
    hidden: true,
    value: (r) => (r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString(dateLocale) : '—'),
  },
  {
    key: 'created',
    label: t('users.created'),
    sortKey: 'created_at',
    hidden: true,
    value: (r) => new Date(r.createdAt).toLocaleDateString(dateLocale),
  },
];
/**
 * Row actions are icons only (the label is the tooltip and the accessible name).
 * Impersonation (D-6) is superadmin-only and never nested; the API enforces exactly the same
 * rules — not yourself, no other superadmin, no deactivated user — this only hides a button
 * that could not work.
 */
const rowActions: RowAction<Row>[] = $derived([
  {
    label: can('user.edit') ? t('common.edit') : t('common.view'),
    icon: can('user.edit') ? 'edit' : 'eye',
    iconOnly: true,
    href: (r) => `/users/${r.id}`,
  },
  ...(data.user.isSuperadmin && !data.impersonator
    ? [
        {
          label: t('users.impersonate'),
          icon: 'login',
          iconOnly: true,
          action: () => '?/impersonate',
          when: (r: Row) => !r.isSuperadmin && r.id !== data.user.id && r.statusId === 1,
        },
      ]
    : []),
]);
const deactivated = $derived(page.url.searchParams.get('deactivated'));
</script>

<svelte:head><title>{t('nav.users')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('nav.users')}</h1>
  </div>
  {#if deactivated}<p class="notice">{t('users.deactivated', { n: deactivated })}</p>{/if}
  <!-- A refused impersonation belongs above the table, not inside the invite card below it. -->
  {#if form?.impersonate && form?.error}<p class="error" role="alert" data-testid="impersonate-error">{form.error}</p>{/if}

  <DataTable
    rows={data.users}
    {columns}
    state={data.state}
    csrf={data.csrf}
    caption={t('users.caption')}
    searchPlaceholder={t('users.search_placeholder')}
    emptyTitle={t('users.empty_title')}
    emptyHint={data.state.q ? t('users.empty_hint_search') : t('users.empty_hint_add')}
    {rowActions}
    bulkActions={can('user.edit') ? [{ action: '?/deactivate', label: t('users.deactivate'), icon: 'lock', destructive: true }] : []}
  >
    {#snippet toolbar()}
      {#if can('user.create')}<Button href="/users/new" size="sm"><Icon name="plus" size={16} />{t('users.add')}</Button>{/if}
    {/snippet}
    {#snippet cell(row, col)}
      {#if col.key === 'status'}
        <Badge variant={row.statusId === 1 ? 'success' : 'secondary'}>{row.statusId === 1 ? t('common.active') : t('common.inactive')}</Badge>
      {:else if col.key === 'name'}
        <a href={`/users/${row.id}`} class="font-medium text-foreground">{row.name}</a>{#if row.isSuperadmin} <Badge variant="outline">superadmin</Badge>{/if}
      {:else}
        {col.value ? (col.value(row) ?? '—') : '—'}
      {/if}
    {/snippet}
  </DataTable>

  {#if can('user.create') && data.invitations}
    <!-- A-13: invite by e-mail. The invitee registers through /join/<code> even with self-service sign-up off. -->
    <Card class="mt-6" title={t('users.invite.title')} description={t('users.invite.lead')} id="invitations">
      {#if form?.invited?.existing}
        <p class="notice" data-testid="invite-existing">{t('users.invite.existing', { email: form.invited.email })}</p>
      {:else if form?.invited}
        <div class="notice grid gap-1" data-testid="invite-sent">
          <p>{t('users.invite.sent', { email: form.invited.email })}</p>
          <p class="text-xs">{t('users.invite.link_hint')} <code class="select-all break-all">{form.invited.link}</code></p>
        </div>
      {/if}
      {#if form?.error && !form?.invited && !form?.impersonate}<p class="error" role="alert">{form.error}</p>{/if}
      <form method="POST" action="?/invite" class="mt-3 flex flex-wrap items-end gap-2" data-testid="invite-form">
        <Csrf token={data.csrf} />
        <label class="grid gap-1 text-sm">{t('users.invite.email')} <input name="email" type="email" required autocomplete="off" class="h-9 w-72 rounded-md border border-input bg-background px-2 text-sm" value={form?.values?.email ?? ''} /></label>
        <Button type="submit" size="sm"><Icon name="mail" size={16} />{t('users.invite.submit')}</Button>
      </form>
      {#if data.invitations.length}
        <table class="mt-4 w-full text-sm" data-testid="invitations">
          <thead class="text-start text-xs text-muted-foreground"><tr><th class="py-1 text-start">{t('users.invite.col_email')}</th><th class="py-1 text-start">{t('users.invite.col_status')}</th><th class="py-1 text-start">{t('users.invite.col_expires')}</th><th class="py-1 text-start">{t('users.invite.col_by')}</th><th class="py-1"></th></tr></thead>
          <tbody>
            {#each data.invitations as inv (inv.id)}
              <tr class="border-t">
                <td class="py-1.5">{inv.email}</td>
                <td class="py-1.5"><Badge variant={inv.status === 'pending' ? 'secondary' : 'destructive'}>{inv.status === 'pending' ? t('users.invite.status_pending') : t('users.invite.status_expired')}</Badge></td>
                <td class="py-1.5 text-muted-foreground">{new Date(inv.expiresAt).toLocaleString(dateLocale)}</td>
                <td class="py-1.5 text-muted-foreground">{inv.invitedBy ?? '—'}</td>
                <td class="py-1.5 text-end"><form method="POST" action="?/revoke"><Csrf token={data.csrf} /><input type="hidden" name="id" value={inv.id} /><Button type="submit" variant="ghost" size="sm">{t('users.invite.revoke')}</Button></form></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="mt-3 text-sm text-muted-foreground">{t('users.invite.empty')}</p>
      {/if}
    </Card>
  {/if}
</div>
