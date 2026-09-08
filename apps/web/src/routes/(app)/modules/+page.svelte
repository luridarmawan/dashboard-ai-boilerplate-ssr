<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

/**
 * Module admin (PRD G-8, G-14). A summary strip, then one card per installed module: identity
 * (source, version, path), what it contributes — counted by modules:sync — as icon chips, its
 * state per scope with the actions that change it, and health (last job status cluster-wide, hooks
 * that threw on this instance). Plain forms everywhere: works without JavaScript.
 */
let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const locale = $derived(data.user.locale === 'en' ? 'en' : 'id');
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID') : '—');
type Mod = (typeof data.modules)[number];
const chips = (c: Mod['contributes']): [string, number, string][] =>
  (
    [
      ['grid', c.tables, 'tabel'],
      ['link', c.api ? 1 : 0, 'API'],
      ['file', c.pages, 'halaman'],
      ['external-link', c.publicRoutes, 'publik'],
      ['menu', c.menu, 'menu'],
      ['shield', c.permissions, 'izin'],
      ['settings', c.config, 'konfigurasi'],
      ['dashboard', c.widgets, 'widget'],
      ['refresh', c.hooks.length, 'hook'],
      ['clock', c.jobs.length, 'job'],
      ['sparkles', c.tools.length, 'tool AI'],
      ['palette', c.themes, 'tema'],
      ['monitor', c.layouts, 'layout'],
      ['image', c.iconSets, 'set ikon'],
    ] as [string, number, string][]
  ).filter(([, n]) => n > 0);
const sourceLabel = (s: string) =>
  s === 'local' ? 'lokal' : s === 'submodule' ? 'repositori terpisah' : s;
const total = $derived(data.modules.length);
const active = $derived(data.modules.filter((m) => m.effective).length);
const unhealthy = $derived(data.modules.filter((m) => m.health.status === 'failed').length);
type CatalogEntry = NonNullable<typeof data.catalog>['entries'][number];
const statusBadge = (s: string): [string, 'success' | 'secondary' | 'outline' | 'destructive'] =>
  s === 'installed'
    ? ['terpasang', 'success']
    : s === 'update'
      ? ['pembaruan', 'secondary']
      : s === 'incompatible'
        ? ['tidak cocok', 'destructive']
        : ['tersedia', 'outline'];
const catalogEntries = $derived(
  [...(data.catalog?.entries ?? [])].sort((a: CatalogEntry, b: CatalogEntry) =>
    a.name.localeCompare(b.name),
  ),
);
</script>

<svelte:head><title>Modul</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1>Modul</h1>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">Menonaktifkan modul menghilangkan menu, route API, widget, tool AI, dan temanya untuk tenant ini; tabelnya tetap ada (G-8). Berlaku seketika di semua instance. Kesehatan: status job terakhir (seluruh instance) dan hook yang gagal (instance ini).</p>
    </div>
    <dl class="grid grid-cols-3 gap-2 text-center">
      <div class="rounded-lg border bg-card px-3 py-2"><dt class="text-[10px] uppercase tracking-wide text-muted-foreground">terpasang</dt><dd class="text-xl font-semibold">{total}</dd></div>
      <div class="rounded-lg border bg-card px-3 py-2"><dt class="text-[10px] uppercase tracking-wide text-muted-foreground">aktif</dt><dd class="text-xl font-semibold text-success">{active}</dd></div>
      <div class="rounded-lg border bg-card px-3 py-2"><dt class="text-[10px] uppercase tracking-wide text-muted-foreground">bermasalah</dt><dd class={`text-xl font-semibold ${unhealthy ? 'text-destructive' : ''}`}>{unhealthy}</dd></div>
    </dl>
  </div>
  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

  <div class="grid gap-4 xl:grid-cols-2">
    {#each data.modules as m (m.name)}
      <div data-testid={`module-${m.ns}`} class="contents">
      <Card class={m.effective ? '' : 'opacity-80'}>
        <div class="flex items-start gap-3">
          <span class={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${m.effective ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}><Icon name="puzzle" size={22} /></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base">{m.name}</h2>
              <code class="text-xs">{m.ns}</code>
              <Badge variant="outline">v{m.version}</Badge>
              <Badge variant={m.effective ? 'success' : 'destructive'}>{m.effective ? 'aktif' : 'nonaktif'}</Badge>
              {#if m.health.status === 'failed'}<Badge variant="destructive"><Icon name="warning" size={12} class="me-1" />bermasalah</Badge>{:else if m.health.status === 'ok'}<Badge variant="secondary"><Icon name="check" size={12} class="me-1" />sehat</Badge>{/if}
            </div>
            {#if m.description}<p class="mt-1 text-sm text-muted-foreground">{m.description[locale]}</p>{/if}
            <p class="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><span>{sourceLabel(m.source)}</span><span aria-hidden="true">·</span><code>{m.path}</code></p>
          </div>
        </div>

        <ul class="mt-4 flex flex-wrap gap-1.5" aria-label="Kontribusi">
          {#each chips(m.contributes) as [icon, n, label] (label)}
            <li class="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"><Icon name={icon} size={12} class="text-muted-foreground" /><span class="font-medium">{n}</span><span class="text-muted-foreground">{label}</span></li>
          {/each}
        </ul>

        <div class="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <p class="text-[10px] uppercase tracking-wide text-muted-foreground">Tenant ini</p>
            <div class="flex flex-wrap items-center gap-2">
              {#if m.tenantEnabled === null}<Badge variant="outline">ikuti global</Badge>{:else}<Badge variant={m.tenantEnabled ? 'success' : 'secondary'}>{m.tenantEnabled ? 'aktif' : 'nonaktif'}</Badge>{/if}
              {#if can('module.manage')}
                <form method="POST" action="?/toggle" class="flex flex-wrap gap-1">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="module" value={m.name} />
                  <input type="hidden" name="scope" value="tenant" />
                  <Button type="submit" name="state" value={m.effective ? 'off' : 'on'} size="sm" variant={m.effective ? 'outline' : 'default'}>{m.effective ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                  {#if m.tenantEnabled !== null}<Button type="submit" name="state" value="inherit" size="sm" variant="ghost">Ikuti global</Button>{/if}
                </form>
              {/if}
            </div>
          </div>
          <div class="grid gap-2">
            <p class="text-[10px] uppercase tracking-wide text-muted-foreground">Global</p>
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant={m.globalEnabled ? 'success' : 'secondary'}>{m.globalEnabled ? 'aktif' : 'nonaktif'}</Badge>
              {#if data.canGlobal}
                <form method="POST" action="?/toggle">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="module" value={m.name} />
                  <input type="hidden" name="scope" value="global" />
                  <Button type="submit" name="state" value={m.globalEnabled ? 'off' : 'on'} size="sm" variant="ghost">{m.globalEnabled ? 'Nonaktifkan global' : 'Aktifkan global'}</Button>
                </form>
              {/if}
            </div>
          </div>
        </div>

        {#if m.health.jobs.length || m.health.hookFailures.length}
          <details class="mt-4 rounded-md border bg-muted/40 text-sm" open={m.health.status === 'failed'}>
            <summary class="cursor-pointer px-3 py-2 text-muted-foreground">Kesehatan — {m.health.jobs.length} job · {m.health.hookFailures.length} hook gagal</summary>
            <div class="grid gap-2 px-3 pb-3">
              {#each m.health.jobs as j (j.name)}
                <div class="flex flex-wrap items-center gap-2">
                  <Icon name="clock" size={14} class="text-muted-foreground" /><code>{j.name}</code>
                  {#if j.lastStatus === 'ok'}<Badge variant="success">ok</Badge>{:else if j.lastStatus === 'failed'}<Badge variant="destructive">gagal</Badge>{:else}<Badge variant="outline">belum pernah jalan</Badge>{/if}
                  <span class="text-xs text-muted-foreground">{fmt(j.lastRunAt)}</span>
                  {#if j.lastError}<span class="basis-full text-xs text-destructive" title={j.lastError}>{j.lastError.slice(0, 160)}</span>{/if}
                </div>
              {/each}
              {#each m.health.hookFailures as f (f.at + f.event)}
                <div class="flex flex-wrap items-center gap-2 text-destructive"><Icon name="warning" size={14} /><code>{f.event}</code><span>{f.error}</span><span class="text-xs text-muted-foreground">{fmt(f.at)}</span></div>
              {/each}
            </div>
          </details>
        {/if}
      </Card>
      </div>
    {/each}
  </div>

  {#if data.catalog}
    <!-- G-16: browse the catalog; installing is a build-time command, shown verbatim -->
    <section class="mt-8" data-testid="module-catalog">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2>Katalog modul</h2>
          <p class="mt-1 max-w-3xl text-sm text-muted-foreground">Modul adalah kode: memasangnya berarti submodule terkunci + migrasi + build baru, jadi katalog menunjukkan perintah yang dijalankan di host (<code>bun modules:install &lt;Nama&gt;</code>), bukan tombol pasang. Sumber: {data.catalog.source === 'url' ? data.catalog.url : data.catalog.source === 'file' ? 'modules.catalog.json' : 'tidak ada'}{#if data.catalog.coreVersion} · core v{data.catalog.coreVersion}{/if}.</p>
        </div>
      </div>
      {#if data.catalog.error}<p class="error mt-3" role="alert">Katalog tidak bisa dimuat: {data.catalog.error}</p>{/if}
      <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {#each catalogEntries as e (e.name)}
          {@const [label, variant] = statusBadge(e.status)}
          <Card class={e.status === 'incompatible' ? 'opacity-70' : ''}>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-base">{e.name}</h3>
              <Badge variant="outline">v{e.version}</Badge>
              <Badge {variant}>{label}{#if e.status === 'update'} dari v{e.installedVersion}{/if}</Badge>
              {#if e.bundled}<Badge variant="secondary">bawaan core</Badge>{/if}
            </div>
            {#if e.description}<p class="mt-1 text-sm text-muted-foreground">{e.description[locale]}</p>{/if}
            {#if e.tags.length}<p class="mt-2 flex flex-wrap gap-1">{#each e.tags as tg (tg)}<code class="text-xs">{tg}</code>{/each}</p>{/if}
            <p class="mt-2 text-xs text-muted-foreground">butuh core <code>{e.engines.core}</code>{#if e.homepage} · <a href={e.homepage} rel="noopener" target="_blank">beranda</a>{/if}</p>
            {#if e.installCommand}
              <pre class="mt-3 overflow-x-auto rounded-md border bg-muted/40 p-2 text-xs"><code>bun modules:install {e.name}
# = {e.installCommand}</code></pre>
            {/if}
          </Card>
        {/each}
      </div>
    </section>
  {/if}
</div>
