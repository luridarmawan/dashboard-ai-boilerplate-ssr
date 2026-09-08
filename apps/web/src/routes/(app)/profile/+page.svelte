<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { type FieldDef, FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, Table } from '$lib/components/ui';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const profileFields: FieldDef[] = $derived([
  { name: 'name', type: 'string', label: 'Nama', required: true, maxlength: 191 },
  {
    name: 'locale',
    type: 'select',
    label: 'Bahasa',
    required: true,
    options: [
      { value: 'id', label: 'Bahasa Indonesia' },
      { value: 'en', label: 'English' },
    ],
  },
  {
    name: 'theme',
    type: 'select',
    label: 'Tema',
    options: data.themes.map((t) => ({ value: t.id, label: t.name })),
    hint: 'Pratinjau dan mode terang/gelap ada di Tema & tampilan.',
  },
  {
    name: 'avatarUrl',
    type: 'string',
    label: 'URL avatar (opsional)',
    maxlength: 512,
    hint: 'Diisi otomatis saat Anda mengunggah foto di bawah; boleh juga URL gambar eksternal.',
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
    label: 'Kata sandi saat ini',
    required: true,
    autocomplete: 'current-password',
  },
  {
    name: 'newPassword',
    type: 'password',
    label: 'Kata sandi baru',
    required: true,
    minlength: 12,
    autocomplete: 'new-password',
  },
  {
    name: 'confirm',
    type: 'password',
    label: 'Ulangi kata sandi baru',
    required: true,
    minlength: 12,
    autocomplete: 'new-password',
  },
];
const tokenFields: FieldDef[] = [
  {
    name: 'name',
    type: 'string',
    label: 'Nama token',
    required: true,
    maxlength: 100,
    placeholder: 'mis. Claude Desktop di laptop',
  },
  {
    name: 'expiresInDays',
    type: 'select',
    label: 'Masa berlaku',
    options: [
      { value: '30', label: '30 hari' },
      { value: '90', label: '90 hari' },
      { value: '365', label: '1 tahun' },
      { value: '', label: 'Tanpa batas' },
    ],
  },
  {
    name: 'scopes',
    type: 'text',
    label: 'Batasi izin (opsional)',
    rows: 2,
    hint: 'Satu izin per baris atau dipisah spasi, mis. example.product.read. Kosong = seluruh izin Anda. Token tidak pernah melebihi izin Anda sendiri.',
  },
];
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID') : '—');
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
const apiError = $derived(form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null);
</script>

<svelte:head><title>Profil</title></svelte:head>

<div class="page">
  <h1>Profil saya</h1>
  <Card title="Foto profil" description="PNG, JPEG, WebP, atau GIF hingga 2 MB; tampil di header di semua tenant Anda.">
    <div class="flex flex-wrap items-center gap-4" data-testid="avatar-card">
      {#if data.user.avatarUrl}
        <img src={data.user.avatarUrl} alt="" class="h-16 w-16 rounded-full border object-cover" />
      {:else}
        <span class="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">{initials}</span>
      {/if}
      <form method="POST" action="?/avatar" enctype="multipart/form-data" class="flex flex-wrap items-center gap-2">
        <Csrf token={data.csrf} />
        <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif" required class="text-sm" />
        <Button type="submit" size="sm"><Icon name="upload" size={14} />Unggah</Button>
      </form>
      {#if data.user.avatarUrl}
        <form method="POST" action="?/avatarRemove"><Csrf token={data.csrf} /><Button type="submit" variant="ghost" size="sm" class="text-destructive"><Icon name="trash" size={14} />Hapus foto</Button></form>
      {/if}
    </div>
    {#if form?.saved === 'avatar'}<p class="notice mt-3">Foto profil diperbarui.</p>{/if}
    {#if form?.saved === undefined && fieldErrors.avatar}<p class="error mt-3" role="alert">{fieldErrors.avatar}</p>{/if}
    {#if form?.saved === undefined && fieldErrors.file}<p class="error mt-3" role="alert">{fieldErrors.file}</p>{/if}
  </Card>
  <Card title="Data diri & preferensi" description={data.user.email}>
    <FormBuilder
      fields={profileFields}
      values={{ name: data.user.name, locale: data.user.locale, theme: data.user.theme ?? '', avatarUrl: data.user.avatarUrl ?? '' }}
      errors={form?.saved === 'password' ? {} : fieldErrors}
      csrf={data.csrf}
      action="?/profile"
      columns={2}
      notice={form?.saved === 'profile' ? 'Profil tersimpan.' : null}
      error={form?.saved === undefined ? apiError : null}
    />
    <p class="mt-3 text-sm text-muted-foreground"><a href="/theme?back=/profile">Tema &amp; tampilan</a> · <a href="/lang?back=/profile">Bahasa</a></p>
  </Card>
  <Card title="Ganti kata sandi" description="Sesi di perangkat lain akan diakhiri.">
    <FormBuilder fields={passwordFields} errors={form?.saved === undefined && form?.code ? {} : fieldErrors} csrf={data.csrf} action="?/password" submitLabel="Ganti kata sandi" notice={form?.saved === 'password' ? 'Kata sandi diganti. Sesi di perangkat lain telah diakhiri.' : null} error={null} />
  </Card>
  <Card title="Token API" description="Untuk klien di luar browser — MCP (Claude Desktop, Claude Code), aplikasi mobile, skrip. Token bertindak sebagai Anda di tenant aktif; kirim sebagai header Authorization: Bearer.">
    {#if form?.saved === 'token' && form.token}
      <div class="notice mb-4" role="status" data-testid="new-token">
        <p class="font-medium">Token “{form.tokenName}” dibuat. Salin sekarang — tidak akan ditampilkan lagi.</p>
        <code class="mt-2 block select-all break-all rounded-md border bg-background px-3 py-2 text-sm">{form.token}</code>
        <p class="mt-2 text-sm text-muted-foreground">Contoh: <code>claude mcp add --transport http dashboard {data.appOrigin ?? ''}/v1/mcp --header "Authorization: Bearer …"</code></p>
      </div>
    {/if}
    {#if form?.saved === 'revoke'}<p class="notice mb-4">Token dicabut.</p>{/if}
    {#if data.tokens.length}
      <Table caption="Token aktif milik Anda">
        <thead><tr><th>Nama</th><th>Izin</th><th>Berlaku sampai</th><th>Terakhir dipakai</th><th></th></tr></thead>
        <tbody>
          {#each data.tokens as tk (tk.id)}
            <tr data-testid="token-row">
              <td class="font-medium">{tk.name}</td>
              <td>{#if tk.scopes?.length}{#each tk.scopes as s (s)}<Badge variant="outline">{s}</Badge> {/each}{:else}<span class="text-muted-foreground">semua izin Anda</span>{/if}</td>
              <td>{tk.expiresAt ? fmt(tk.expiresAt) : 'tanpa batas'}</td>
              <td>{fmt(tk.lastUsedAt)}</td>
              <td class="text-right">
                <form method="POST" action="?/revokeToken"><Csrf token={data.csrf} /><input type="hidden" name="id" value={tk.id} /><Button type="submit" variant="ghost" size="sm" class="text-destructive"><Icon name="trash" size={14} />Cabut</Button></form>
              </td>
            </tr>
          {/each}
        </tbody>
      </Table>
    {:else}
      <p class="mb-3 text-sm text-muted-foreground">Belum ada token.</p>
    {/if}
    <div class="mt-4">
      <FormBuilder fields={tokenFields} values={{ expiresInDays: '90' }} errors={form?.code === 'validation_failed' && form?.saved === undefined ? fieldErrors : {}} csrf={data.csrf} action="?/createToken" submitLabel="Buat token" columns={2} notice={null} error={form?.saved === undefined && form?.values && 'name' in (form.values as object) ? apiError : null} />
    </div>
  </Card>
</div>
