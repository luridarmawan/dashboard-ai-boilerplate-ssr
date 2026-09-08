<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Table } from '$lib/components/ui';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { PageData } from './$types';

let { data }: { data: PageData & LayoutData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID') : '—');
</script>

<svelte:head><title>Webhook keluar</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>Webhook keluar</h1>
    {#if can('webhook.manage')}<Button href="/webhooks/new" size="sm"><Icon name="plus" size={16} />Tambah webhook</Button>{/if}
  </div>
  <p class="text-sm text-muted-foreground">Event inti tenant ini (pengguna dibuat, konfigurasi disimpan, modul di-toggle, notifikasi, …) dikirim sebagai POST JSON bertanda tangan ke URL yang Anda daftarkan, dengan percobaan ulang otomatis.</p>
  {#if data.saved === 'deleted'}<p class="notice">Webhook dihapus.</p>{/if}
  <Table caption="Webhook keluar">
    <thead><tr><th>Nama</th><th>URL</th><th>Event</th><th>Status terakhir</th><th></th></tr></thead>
    <tbody>
      {#each data.webhooks as w (w.id)}
        <tr data-testid="webhook-row">
          <td class="font-medium">{w.name}{#if !w.enabled} <Badge variant="secondary">nonaktif</Badge>{/if}</td>
          <td class="max-w-[22rem] truncate text-muted-foreground" title={w.url}>{w.url}</td>
          <td>{#each w.events as e (e)}<code class="me-1">{e}</code>{/each}</td>
          <td>
            {#if w.lastStatus === 'ok'}<Badge variant="success">ok</Badge>
            {:else if w.lastStatus === 'error'}<span title={w.lastError ?? ''}><Badge variant="destructive">error</Badge></span>
            {:else}<span class="text-muted-foreground">belum ada</span>{/if}
            <span class="ms-1 text-xs text-muted-foreground">{fmt(w.lastDeliveredAt)}</span>
          </td>
          <td class="text-end"><a href={`/webhooks/${w.id}`}>{can('webhook.manage') ? 'Kelola' : 'Lihat'}</a></td>
        </tr>
      {:else}
        <tr><td colspan="5" class="py-8 text-center text-muted-foreground">Belum ada webhook.</td></tr>
      {/each}
    </tbody>
  </Table>
</div>
