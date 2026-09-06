<script lang="ts">
import type { LayoutData } from '../$types';

let { data }: { data: LayoutData } = $props();
</script>

<svelte:head><title>Dasbor</title></svelte:head>

<main>
  <h1>Halo, {data.user.name}</h1>
  <div class="card">
    <p><strong>Email:</strong> {data.user.email}{#if data.user.isSuperadmin} · <code>superadmin</code>{/if}</p>
    <p><strong>Tenant aktif:</strong> {data.tenants.find((t) => t.id === data.clientId)?.name ?? '—'}</p>
    <p><strong>Izin efektif:</strong> {#if data.permissions.length}{#each data.permissions as p (p)}<code>{p}</code>{' '}{/each}{:else}<span class="muted">tidak ada</span>{/if}</p>
  </div>
  <p class="muted">Widget dasbor dan tema hadir di M2 (G-19, FR-L).</p>
</main>
