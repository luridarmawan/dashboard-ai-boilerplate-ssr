<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from './$types';

let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

// Cosmetic only (C-6b): the API refuses what the menu merely hides.
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const active = $derived(data.tenants.find((t) => t.id === data.clientId));
</script>

<header class="bar">
  <nav class="row">
    <a href="/dashboard"><strong>Dashboard</strong></a>
    {#if can('user.read')}<a href="/users">Pengguna</a>{/if}
    {#if can('group.read')}<a href="/groups">Grup &amp; izin</a>{/if}
    {#if can('client.read')}<a href="/tenants">Tenant</a>{/if}
    <a href="/profile">Profil</a>
  </nav>
  <div class="row">
    {#if data.tenants.length > 1}
      <!-- Tenant switcher (B-4): a POST and a full server-side navigation; hidden for one tenant (B-5). -->
      <form method="POST" action="/auth/switch-tenant" class="row">
        <Csrf token={data.csrf} />
        <input type="hidden" name="back" value={data.path} />
        <label class="row">Tenant
          <select name="clientId">
            {#each data.tenants as t (t.id)}
              <option value={t.id} selected={t.id === data.clientId}>{t.name}</option>
            {/each}
          </select>
        </label>
        <button type="submit" class="secondary">Ganti</button>
      </form>
    {:else if active}
      <span class="muted">Tenant: {active.name}</span>
    {/if}
    <span class="muted">{data.user.name}</span>
    <form method="POST" action="/auth/logout">
      <Csrf token={data.csrf} />
      <button type="submit" class="secondary">Keluar</button>
    </form>
  </div>
</header>
{#if data.tenantError}<main><p class="error">Tenant tidak bisa diganti — Anda bukan anggotanya.</p></main>{/if}

{@render children()}

<style>
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .6rem 1rem; background: #fff; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  nav a { margin-right: .9rem; text-decoration: none; }
</style>
