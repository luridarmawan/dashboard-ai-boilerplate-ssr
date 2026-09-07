<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

/**
 * Module admin (PRD G-8, G-14): one card per installed module — identity (source, version, path),
 * what it contributes (as counted by modules:sync), enable/disable per tenant or globally, and
 * health: the last status of its scheduled jobs and any hook that threw on this instance.
 */
let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const locale = $derived(data.user.locale === 'en' ? 'en' : 'id');
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID') : '—');
type Mod = (typeof data.modules)[number];
const chips = (c: Mod['contributes']) =>
  [
    [c.tables, 'tabel'],
    [c.api ? 1 : 0, 'API'],
    [c.pages, 'halaman'],
    [c.publicRoutes, 'halaman publik'],
    [c.menu, 'menu'],
    [c.permissions, 'izin'],
    [c.config, 'konfigurasi'],
    [c.widgets, 'widget'],
    [c.hooks.length, 'hook'],
    [c.jobs.length, 'job'],
    [c.tools.length, 'tool AI'],
    [c.themes, 'tema'],
    [c.layouts, 'layout'],
    [c.iconSets, 'set ikon'],
  ].filter(([n]) => Number(n) > 0) as [number, string][];
const sourceLabel = (s: string) =>
  s === 'local' ? 'lokal (modules/)' : s === 'submodule' ? 'repositori terpisah (submodule)' : s;
</script>

<svelte:head><title>Modul</title></svelte:head>

<div class="page">
  <h1>Modul</h1>
  <p class="text-sm text-muted-foreground">Modul nonaktif: menu, route API, widget, tool AI, dan temanya hilang untuk tenant ini; tabelnya tetap ada (G-8). Berlaku seketika di semua instance. Kesehatan: status terakhir job (seluruh instance) dan hook yang gagal (instance ini).</p>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <div class="grid gap-4">
    {#each data.modules as m (m.name)}
      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3" data-testid={`module-${m.ns}`}>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="m-0 text-base font-semibold">{m.name}</h2>
              <code class="text-xs text-muted-foreground">{m.ns} · v{m.version}</code>
              <Badge variant={m.effective ? 'success' : 'destructive'}>{m.effective ? 'aktif' : 'nonaktif'}</Badge>
              {#if m.health.status === 'failed'}<Badge variant="destructive">bermasalah</Badge>{:else if m.health.status === 'ok'}<Badge variant="outline">sehat</Badge>{/if}
            </div>
            {#if m.description}<p class="mt-1 text-sm text-muted-foreground">{m.description[locale]}</p>{/if}
            <p class="mt-1 text-xs text-muted-foreground">{sourceLabel(m.source)} · <code>{m.path}</code></p>
            <p class="mt-2 flex flex-wrap gap-1">
              {#each chips(m.contributes) as [n, label] (label)}
                <span class="rounded-sm bg-muted px-1.5 py-0.5 text-xs">{n} {label}</span>
              {/each}
            </p>
          </div>
          <div class="grid gap-2 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-muted-foreground">Global</span>
              <Badge variant={m.globalEnabled ? 'success' : 'secondary'}>{m.globalEnabled ? 'aktif' : 'nonaktif'}</Badge>
              <span class="text-muted-foreground">Tenant ini</span>
              {#if m.tenantEnabled === null}<span class="text-muted-foreground">ikuti global</span>{:else}<Badge variant={m.tenantEnabled ? 'success' : 'secondary'}>{m.tenantEnabled ? 'aktif' : 'nonaktif'}</Badge>{/if}
            </div>
            {#if can('module.manage')}
              <form method="POST" action="?/toggle" class="flex flex-wrap gap-1">
                <Csrf token={data.csrf} />
                <input type="hidden" name="module" value={m.name} />
                <input type="hidden" name="scope" value="tenant" />
                <Button type="submit" name="state" value={m.effective ? 'off' : 'on'} size="sm" variant={m.effective ? 'destructive' : 'default'}>{m.effective ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                {#if m.tenantEnabled !== null}<Button type="submit" name="state" value="inherit" size="sm" variant="outline">Ikuti global</Button>{/if}
              </form>
              {#if data.canGlobal}
                <form method="POST" action="?/toggle" class="flex gap-1">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="module" value={m.name} />
                  <input type="hidden" name="scope" value="global" />
                  <Button type="submit" name="state" value={m.globalEnabled ? 'off' : 'on'} size="sm" variant="ghost">{m.globalEnabled ? 'Nonaktifkan global' : 'Aktifkan global'}</Button>
                </form>
              {/if}
            {/if}
          </div>
        </div>
        {#if m.health.jobs.length || m.health.hookFailures.length}
          <details class="mt-3 text-sm" open={m.health.status === 'failed'}>
            <summary class="cursor-pointer text-muted-foreground">Kesehatan: {m.health.jobs.length} job · {m.health.hookFailures.length} hook gagal</summary>
            {#if m.health.jobs.length}
              <ul class="mt-2 grid gap-1">
                {#each m.health.jobs as j (j.name)}
                  <li class="flex flex-wrap items-center gap-2">
                    <Icon name="clock" size={14} /><code>{j.name}</code>
                    {#if j.lastStatus === 'ok'}<Badge variant="success">ok</Badge>{:else if j.lastStatus === 'failed'}<Badge variant="destructive">gagal</Badge>{:else}<span class="text-muted-foreground">belum pernah jalan</span>{/if}
                    <span class="text-xs text-muted-foreground">{fmt(j.lastRunAt)}</span>
                    {#if j.lastError}<span class="text-xs text-destructive" title={j.lastError}>{j.lastError.slice(0, 120)}</span>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if m.health.hookFailures.length}
              <ul class="mt-2 grid gap-1">
                {#each m.health.hookFailures as f (f.at + f.event)}
                  <li class="flex flex-wrap items-center gap-2 text-destructive"><Icon name="warning" size={14} /><code>{f.event}</code> <span>{f.error}</span> <span class="text-xs text-muted-foreground">{fmt(f.at)}</span></li>
                {/each}
              </ul>
            {/if}
          </details>
        {/if}
      </Card>
    {/each}
  </div>
</div>
