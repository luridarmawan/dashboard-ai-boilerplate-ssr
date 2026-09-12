<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { iconActionClass } from '$lib/components/table';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
// Registry resource names are bilingual data from the API: pick the active locale's field.
const locale = useLocale() === 'en' ? 'en' : 'id';
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const g = $derived(data.group);
const granted = $derived(new Set(g.permissions.map((p) => p.permission)));
// Anything not representable as a matrix cell (wildcards, unknown-to-registry leftovers).
const matrixKeys = $derived(
  new Set(data.registry.flatMap((r) => r.actions.map((a) => `${r.resource}.${a}`))),
);
const extras = $derived([...granted].filter((p) => !matrixKeys.has(p)));
const memberIds = $derived(new Set(g.members.map((m) => m.userId)));
const mp = $derived(data.group.memberPage);
/** Links that move through the roster keep the candidate search that is open next to it. */
const memberHref = (page: number, q: string) => {
  const p = new URLSearchParams();
  if (q) p.set('mq', q);
  if (page > 1) p.set('mpage', String(page));
  if (data.candidateQuery) p.set('cq', data.candidateQuery);
  const s = p.toString();
  return s ? `?${s}` : '?';
};
const candidates = $derived(data.tenantUsers.filter((u) => !memberIds.has(u.id)));
const editable = $derived(can('group.edit'));
/** Open on `?confirm=delete`, and stay open when the action bounced the typed code back. */
const confirming = $derived(data.confirmDelete || form?.code === 'confirm_failed');
</script>

<svelte:head><title>{t('groups.detail.title', { name: g.name })}</title></svelte:head>

<div class="page">
  <h1>{g.name} <code>{g.code}</code>{#if g.isSystem} <span class="muted">{t('groups.detail.system')}</span>{/if}</h1>
  {#if form?.saved}<p class="notice">{t('groups.detail.saved')}</p>{/if}
  {#if form?.error && form.code !== 'confirm_failed'}
    <p class="error">{form.error}{#if form.details && typeof form.details === 'object' && 'unknown' in form.details} — {(form.details as { unknown: string[] }).unknown.join(', ')}{/if}</p>
  {/if}

  <form method="POST" action="?/save" class="stack">
    <Csrf token={data.csrf} />
    <label>{t('groups.name')} <input name="name" required maxlength="191" value={g.name} disabled={!editable} /></label>
    <label>{t('groups.description')} <textarea name="description" rows="2" disabled={!editable}>{g.description ?? ''}</textarea></label>
    {#if editable}<div><button type="submit">{t('common.save')}</button></div>{/if}
  </form>

  <h2>{t('groups.permissions')}</h2>
  <form method="POST" action="?/permissions" class="stack" style="max-width: none">
    <Csrf token={data.csrf} />
    <table>
      <thead><tr><th>{t('groups.detail.resource')}</th><th>{t('groups.detail.module')}</th><th>{t('common.actions')}</th></tr></thead>
      <tbody>
        {#each data.registry as r (r.resource)}
          <tr>
            <td>{r.name[locale]} <code>{r.resource}</code></td>
            <td class="muted">{r.module}</td>
            <td class="row">
              {#each r.actions as a (a)}
                <label class="check"><input type="checkbox" name="perm" value={`${r.resource}.${a}`} checked={granted.has(`${r.resource}.${a}`)} disabled={!editable} /> {a}</label>
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <label>{t('groups.detail.extra')} <code>*.*</code>, <code>user.*</code>, <code>*.read</code>
      <input name="extra" value={extras.join(' ')} disabled={!editable} /></label>
    {#if editable}<div><button type="submit">{t('groups.detail.save_permissions')}</button></div>{/if}
  </form>

  <h2>{t('groups.detail.members_count', { n: g.memberCount })}</h2>
  <!-- The roster is one page of `?mpage`, searched by `?mq` — both plain GET, no JavaScript. -->
  <form method="GET" class="row">
    {#if data.candidateQuery}<input type="hidden" name="cq" value={data.candidateQuery} />{/if}
    <input name="mq" value={data.memberQuery} aria-label={t('groups.detail.member_filter')} placeholder={t('groups.detail.member_filter')} />
    <button type="submit" class="secondary">{t('common.search')}</button>
    {#if data.memberQuery}<a href={memberHref(1, '')}>{t('groups.detail.show_all_members')}</a>{/if}
  </form>
  <table>
    <thead><tr><th>{t('users.name')}</th><th>{t('users.email')}</th><th></th></tr></thead>
    <tbody>
      {#each g.members as m (m.id)}
        <tr>
          <td>{m.name}</td><td>{m.email}</td>
          <td>
            {#if editable}
              <form method="POST" action="?/removeMember" class="row">
                <Csrf token={data.csrf} />
                <input type="hidden" name="userId" value={m.userId} />
                <!-- Icon-only, like a row action elsewhere: the label is the tooltip and the accessible name. -->
                <button type="submit" class={iconActionClass} title={t('groups.detail.remove_member')} aria-label={t('groups.detail.remove_member')}><Icon name="x" size={16} /></button>
              </form>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="3" class="muted">{t('groups.detail.no_members')}</td></tr>
      {/each}
    </tbody>
  </table>
  {#if mp.totalPages > 1}
    <nav class="row" aria-label={t('table.pagination')}>
      {#if mp.page > 1}<a href={memberHref(mp.page - 1, data.memberQuery)} rel="prev">{t('table.prev')}</a>{/if}
      <span class="muted">{t('table.page')} {mp.page} {t('table.of')} {mp.totalPages} · {mp.total} {t('table.rows')}</span>
      {#if mp.page < mp.totalPages}<a href={memberHref(mp.page + 1, data.memberQuery)} rel="next">{t('table.next')}</a>{/if}
    </nav>
  {/if}
  {#if editable}
    <!-- Search first, then pick: the tenant may hold thousands of users and one API page is 100
         rows, so a <select> of "everyone" would quietly leave most of them out. A GET form, so
         this works without JavaScript like the rest of the page. -->
    <form method="GET" class="row" style="margin-top:.75rem">
      {#if data.memberQuery}<input type="hidden" name="mq" value={data.memberQuery} />{/if}
      <input name="cq" value={data.candidateQuery} aria-label={t('groups.detail.member_search')} placeholder={t('groups.detail.member_search')} />
      <button type="submit">{t('common.search')}</button>
    </form>
    {#if candidates.length}
      <form method="POST" action="?/addMember" class="row" style="margin-top:.5rem">
        <Csrf token={data.csrf} />
        <select name="userId">
          {#each candidates as u (u.id)}<option value={u.id}>{u.name} — {u.email}</option>{/each}
        </select>
        <button type="submit">{t('groups.detail.add_member')}</button>
      </form>
      {#if data.moreCandidates}<p class="muted">{t('groups.detail.more_candidates', { n: data.moreCandidates })}</p>{/if}
    {:else}
      <p class="muted">{t('groups.detail.no_candidates')}</p>
    {/if}
  {/if}

  {#if can('group.manage') && !g.isSystem}
    <h2 id="delete">{t('groups.detail.delete')}</h2>
    {#if confirming}
      <!-- Two-step confirmation (no JavaScript required): the code has to be typed, and the action checks it again. -->
      <p class="error" role="alert">{t('groups.detail.delete_confirm_lead', { name: g.name, n: g.members.length })}</p>
      <form method="POST" action="?/delete&confirm=delete" class="stack">
        <Csrf token={data.csrf} />
        <label>{t('groups.detail.delete_confirm_code', { code: g.code })}
          <input name="code" autocomplete="off" autocapitalize="none" spellcheck="false" required />
        </label>
        {#if form?.code === 'confirm_failed'}<p class="error" role="alert">{form.error}</p>{/if}
        <div class="row">
          <button type="submit" class="danger">{t('groups.detail.delete_confirm_submit')}</button>
          <a class="btn secondary" href={`/groups/${g.id}`}>{t('common.cancel')}</a>
        </div>
      </form>
    {:else}
      <div class="row">
        <a class="btn danger" href={`/groups/${g.id}?confirm=delete#delete`}>{t('groups.detail.delete')}</a>
        <span class="muted">{t('groups.detail.delete_hint')}</span>
      </div>
    {/if}
  {/if}
  <p><a href="/groups">← {t('groups.detail.all_groups')}</a></p>
</div>
